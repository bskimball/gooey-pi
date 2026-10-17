const $ = (id) => document.getElementById(id)
let tab = null
let shared = null

async function send(message) {
  const response = await chrome.runtime.sendMessage(message)
  if (response?.error) throw new Error(response.error)
  return response?.result
}

function hostOf(url) {
  try { return new URL(url).hostname } catch { return '' }
}

function render(state) {
  const connected = state.connected === true
  const shareable = /^https?:/.test(tab?.url || '')
  shared = state.tabs?.find((item) => item.chromeTabId === tab?.id) || null
  const paused = shared?.paused === true
  document.body.dataset.connected = String(connected)
  document.body.dataset.paired = String(!!shared)
  document.body.dataset.paused = String(paused)
  $('connection').textContent = connected ? 'Connected to Apex' : 'Disconnected'
  $('tab-title').textContent = tab?.title || 'This tab'
  $('tab-host').textContent = hostOf(tab?.url || '')
  $('agent-state').textContent = paused ? 'Paused by you' : 'Agent active'
  $('share').textContent = shared ? 'Stop sharing tab' : 'Share this tab with Apex'
  $('share').disabled = !connected || (!shared && (!shareable || !state.activeSessionKey))
  $('pause').textContent = paused ? 'Resume agent' : 'Pause agent'
  $('pause').disabled = !connected
  $('hint').textContent = !connected
    ? 'Open Apex on this computer to connect.'
    : shared
      ? ''
      : !shareable
        ? 'Only web pages can be shared.'
        : state.activeSessionKey ? 'The agent in the open Apex thread will be able to use this tab.' : 'Open a thread in Apex to share this tab with it.'
}

async function refresh() {
  render(await send({ type: 'GET_STATE' }))
}

async function run(message) {
  $('error').textContent = ''
  for (const id of ['share', 'pause']) $(id).disabled = true
  try {
    await send({ ...message, chromeTabId: tab.id })
    // The tab's status pill mirrors pairing; nudge it instead of waiting for its next check.
    void chrome.tabs.sendMessage(tab.id, { type: 'APEX_TAB_STATE_CHANGED' }).catch(() => undefined)
  } catch (error) {
    $('error').textContent = error.message
  }
  await refresh().catch((error) => { $('error').textContent = error.message })
}

$('share').addEventListener('click', () => { void run(shared ? { type: 'UNPAIR_TAB' } : { type: 'PAIR_CURRENT_TAB' }) })
$('pause').addEventListener('click', () => { void run({ type: 'SET_TAB_PAUSED', paused: !(shared?.paused === true) }) })

void chrome.tabs.query({ active: true, currentWindow: true })
  .then(([active]) => { tab = active || null; return refresh() })
  .catch((error) => { $('error').textContent = error.message })
