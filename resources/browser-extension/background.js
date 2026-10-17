const DEFAULT_BRIDGE = 'http://127.0.0.1:29301'
let base = DEFAULT_BRIDGE
let token = null
let activeSessionKey = null
let connected = false
let connecting = false
let retryMs = 1000
const tabs = new Map()
const attached = new Set()
const syntheticAllowances = new Map()
const commandTails = new Map()

function allowSyntheticInput(id, method, params) {
  if (method !== 'cdp') return null
  const input = params.params || {}
  let kind
  if (params.method === 'Input.dispatchMouseEvent' && input.type === 'mousePressed') kind = 'pointer'
  else if (params.method === 'Input.dispatchMouseEvent' && input.type === 'mouseWheel') kind = 'wheel'
  else if (params.method === 'Input.dispatchKeyEvent' && ['keyDown', 'rawKeyDown'].includes(input.type)) kind = 'key'
  if (!kind) return null
  const allowance = { kind, x: input.x, y: input.y, count: 1, expiresAt: Date.now() + 1000 }
  const pending = (syntheticAllowances.get(id) || []).filter((item) => item.expiresAt > Date.now() && item.count > 0)
  pending.push(allowance)
  syntheticAllowances.set(id, pending)
  return allowance
}
function consumeSyntheticInput(id, message) {
  const pending = (syntheticAllowances.get(id) || []).filter((item) => item.expiresAt > Date.now() && item.count > 0)
  const match = pending.find((item) => item.kind === message.kind && ((item.kind !== 'pointer' && item.kind !== 'wheel')
    || (Number.isFinite(message.x) && Number.isFinite(message.y) && Math.hypot(message.x - item.x, message.y - item.y) <= 4)))
  if (match) match.count -= 1
  if (match) syntheticAllowances.set(id, pending.filter((item) => item.count > 0))
  else syntheticAllowances.delete(id)
  return !!match
}
const PAUSED = 'Tab is paused by the user. Ask the user to resume agent control or wait until they finish.'

async function post(path, payload) {
  const response = await fetch(`${base}/v1/extension/${path}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || `Bridge returned ${response.status}`)
  return result
}
async function event(type, payload) { return post('event', { type, ...payload }) }
async function groupTab(tabId) {
  const tab = await chrome.tabs.get(tabId)
  const groups = await chrome.tabGroups.query({ title: 'Apex', windowId: tab.windowId })
  const groupId = await chrome.tabs.group({ tabIds: [tabId], ...(groups[0] ? { groupId: groups[0].id } : {}) })
  await chrome.tabGroups.update(groupId, { title: 'Apex', color: 'blue', collapsed: false })
}
async function waitForLoad(tabId) {
  const deadline = Date.now() + 15000
  do {
    await new Promise((resolve) => setTimeout(resolve, 150))
    if ((await chrome.tabs.get(tabId)).status !== 'loading') return
  } while (Date.now() < deadline)
}
async function cdp(tabId, method, params = {}) {
  if (!attached.has(tabId)) {
    await chrome.debugger.attach({ tabId }, '1.3')
    attached.add(tabId)
  }
  return chrome.debugger.sendCommand({ tabId }, method, params)
}
function execute(command) {
  const id = command.params.chromeTabId
  if (!Number.isInteger(id) || command.method === 'sync_tab_state') return executeNow(command)
  const run = (commandTails.get(id) || Promise.resolve()).then(() => executeNow(command))
  const tail = run.catch(() => undefined)
  commandTails.set(id, tail)
  void tail.then(() => { if (commandTails.get(id) === tail) commandTails.delete(id) })
  return run
}
async function executeNow({ method, params }) {
  const id = params.chromeTabId
  if (method === 'sync_tab_state') {
    if ('activeSessionKey' in params) activeSessionKey = params.activeSessionKey
    if (Array.isArray(params.tabs)) {
      tabs.clear()
      for (const tab of params.tabs) if (Number.isInteger(tab.chromeTabId)) tabs.set(tab.chromeTabId, tab)
    }
    if (Number.isInteger(id) && tabs.has(id) && typeof params.paused === 'boolean') tabs.get(id).paused = params.paused
    return true
  }
  if (method === 'create_tab') {
    const tab = await chrome.tabs.create({ url: params.url, active: false })
    await groupTab(tab.id)
    tabs.set(tab.id, { chromeTabId: tab.id, paused: false })
    await waitForLoad(tab.id)
    return tab.id
  }
  if (!tabs.has(id)) throw new Error('This browser tab is not shared with Apex')
  if (method === 'focus_tab') {
    const tab = await chrome.tabs.update(id, { active: true })
    await chrome.windows.update(tab.windowId, { focused: true })
    return true
  }
  if (method === 'close_tab') { tabs.delete(id); await chrome.tabs.remove(id); return true }
  if (tabs.get(id).paused && !['screenshot', 'read_page'].includes(method)) throw new Error(PAUSED)
  const allowance = allowSyntheticInput(id, method, params)
  try {
    if (method === 'navigate') {
      if (params.url) {
        const result = await cdp(id, 'Page.navigate', { url: params.url })
        if (result.errorText) throw new Error(`Navigation failed: ${result.errorText}`)
        await waitForLoad(id)
        return result
      }
      if (params.action === 'reload') {
        await cdp(id, 'Page.reload')
        await waitForLoad(id)
        return true
      }
      const history = await cdp(id, 'Page.getNavigationHistory')
      const entry = history.entries[history.currentIndex + (params.action === 'back' ? -1 : 1)]
      if (!entry) throw new Error('There is no page in that direction')
      await cdp(id, 'Page.navigateToHistoryEntry', { entryId: entry.id })
      await waitForLoad(id)
      return true
    }
    if (method === 'evaluate' || method === 'read_page') {
      const response = await cdp(id, 'Runtime.evaluate', { expression: params.script, returnByValue: true, awaitPromise: true })
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
      return response.result.value
    }
    if (method === 'screenshot') {
      const result = await cdp(id, 'Page.captureScreenshot', { format: 'jpeg', quality: 70, captureBeyondViewport: false })
      return result.data
    }
    if (method === 'cdp') return await cdp(id, params.method, params.params)
    throw new Error(`Unknown extension command: ${method}`)
  } catch (error) {
    if (allowance) syntheticAllowances.set(id, (syntheticAllowances.get(id) || []).filter((item) => item !== allowance))
    throw error
  }
}

async function connect() {
  if (connecting) return
  connecting = true
  try {
    const settings = await chrome.storage.local.get('bridgeUrl')
    // Optional override also permits connecting when the preferred desktop port was busy.
    base = /^http:\/\/127\.0\.0\.1:\d+$/.test(settings.bridgeUrl || '') ? settings.bridgeUrl : DEFAULT_BRIDGE
    const hello = await fetch(`${base}/v1/extension/hello`)
    if (!hello.ok) throw new Error('Apex bridge is unavailable')
    const state = await hello.json()
    token = state.token
    activeSessionKey = state.activeSessionKey
    const previous = new Map(tabs)
    tabs.clear()
    for (const tab of state.tabs || []) {
      if (!Number.isInteger(tab.chromeTabId)) continue
      const paused = previous.get(tab.chromeTabId)?.paused || tab.paused || false
      tabs.set(tab.chromeTabId, { ...tab, paused })
      try {
        const current = await chrome.tabs.get(tab.chromeTabId)
        await event('tab_updated', { chromeTabId: current.id, url: current.url, title: current.title })
        if (paused !== tab.paused) await event('tab_pause_changed', { chromeTabId: current.id, paused, reason: 'user_input' })
      } catch {
        tabs.delete(tab.chromeTabId)
        await event('tab_closed', { chromeTabId: tab.chromeTabId })
      }
    }
    const response = await fetch(`${base}/v1/extension/events`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok || !response.body) throw new Error('Cannot open extension event stream')
    connected = true
    retryMs = 1000
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        boundary = buffer.indexOf('\n\n')
        if (!block.startsWith('data: ')) continue
        const command = JSON.parse(block.slice(6))
        void execute(command).then(
          (result) => post('result', { id: command.id, result }),
          (error) => post('result', { id: command.id, error: error.message }),
        ).catch(() => undefined)
      }
    }
  } catch { /* Desktop may not be running; retry below. */ }
  finally {
    connected = false
    connecting = false
    setTimeout(() => { void connect() }, retryMs)
    retryMs = Math.min(retryMs * 2, 30000)
  }
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  void (async () => {
    if (message.type === 'GET_STATE') return { connected, activeSessionKey, tabs: [...tabs.values()], senderTabId: sender.tab?.id }
    const tab = sender.tab || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]
    const id = message.chromeTabId ?? tab?.id
    if (!Number.isInteger(id)) throw new Error('No browser tab selected')
    if (message.type === 'PAIR_CURRENT_TAB') {
      const current = await chrome.tabs.get(id)
      await event('tab_paired', { chromeTabId: id, url: current.url, title: current.title })
      tabs.set(id, { chromeTabId: id, paused: false })
      return true
    }
    if (!tabs.has(id)) return false
    if (message.type === 'UNPAIR_TAB') {
      await event('tab_unpaired', { chromeTabId: id })
      tabs.delete(id)
      if (attached.has(id)) await chrome.debugger.detach({ tabId: id })
      return true
    }
    if (message.type === 'SET_TAB_PAUSED' || message.type === 'USER_INTERACTION_DETECTED') {
      if (message.type === 'USER_INTERACTION_DETECTED' && consumeSyntheticInput(id, message)) return false
      const paused = message.type === 'USER_INTERACTION_DETECTED' ? true : message.paused
      if (typeof paused !== 'boolean') throw new Error('paused must be a boolean')
      tabs.get(id).paused = paused
      await event('tab_pause_changed', { chromeTabId: id, paused, reason: message.type === 'USER_INTERACTION_DETECTED' ? 'user_input' : 'pill_toggle' })
      return true
    }
    return false
  })().then((result) => reply({ result }), (error) => reply({ error: error.message }))
  return true
})
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  if (tabs.has(id)) void event('tab_updated', { chromeTabId: id, url: tab.url, title: tab.title, loading: change.status === 'loading' }).catch(() => undefined)
})
chrome.tabs.onRemoved.addListener((id) => {
  syntheticAllowances.delete(id)
  attached.delete(id)
  if (tabs.delete(id)) void event('tab_closed', { chromeTabId: id }).catch(() => undefined)
})
chrome.debugger.onDetach.addListener(({ tabId }) => {
  attached.delete(tabId)
  if (tabs.has(tabId)) {
    tabs.get(tabId).paused = true
    void event('tab_pause_changed', { chromeTabId: tabId, paused: true, reason: 'user_input' }).catch(() => undefined)
  }
})
chrome.alarms.create('apex-reconnect', { periodInMinutes: 0.5 })
chrome.alarms.onAlarm.addListener(() => { void connect() })
void connect()
