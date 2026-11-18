import { styles as responsiveLayoutStyles } from 'apex-ui/styles/responsive-layout.stylex';
import { styles as settingsStyles } from 'apex-ui/styles/settings.stylex'
import { styles as responsiveStyles } from 'apex-ui/styles/responsive.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as inspectorStyles } from 'apex-ui/styles/inspector.stylex'
import { styles as overlaysStyles } from 'apex-ui/styles/overlays.stylex'
import * as stylex from '@stylexjs/stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { TextInput } from '@astryxdesign/core/TextInput'
import { useMachine } from '@xstate/react'
import { ArrowsClockwise, Broadcast, Check, CircleNotch, HardDrives, Key, Laptop, MicrophoneStage, ShieldCheck, ShieldWarning, Trash, Waves } from '@/components/icons'
import { AnimatePresence } from 'motion/react'
import { useEffect, useState } from 'react'
import { ApexButton, IconButton, Modal, SelectControl } from '@/components/ui'
import { errorMessage } from '@/lib/errors'
import { shortcutLabel } from '@/lib/platform-shortcuts'
import {
  DEEPGRAM_MODELS,
  GROQ_MODELS,
  OPENAI_FILE_MODELS,
  OPENAI_LIVE_MODELS,
  REALTIME_MODELS,
  REALTIME_VOICES,
  VOICE_PROVIDER_OPTIONS,
  optionsWithCurrent,
  type VoiceOption,
} from '@/lib/voice-options'
import type { AppSettings, ApexApi, VoiceCredentialProvider, VoiceTranscriptionProvider } from '@/types/api'
import type { SettingsSectionProps } from './contracts'
import { voiceSettingsMachine } from './voiceSettingsMachine'

const spin = stylex.keyframes({ to: { transform: 'rotate(360deg)' } })
const styles = stylex.create({ spinning: { animationName: spin, animationDuration: '900ms', animationTimingFunction: 'linear', animationIterationCount: 'infinite' } })

const CREDENTIALS: Array<{ id: VoiceCredentialProvider; name: string; monogram: string; detail: string }> = [
  { id: 'openai', name: 'OpenAI', monogram: 'OA', detail: 'Required for live dictation and the realtime orb.' },
  { id: 'groq', name: 'Groq', monogram: 'GQ', detail: 'Used only when Groq is your dictation provider.' },
  { id: 'deepgram', name: 'Deepgram', monogram: 'DG', detail: 'Used only when Deepgram is your dictation provider.' },
  { id: 'self-hosted', name: 'Self-hosted endpoint', monogram: 'SH', detail: 'Optional bearer token for your Parakeet or Whisper server.' },
]

const CONNECTION_CREDENTIALS = CREDENTIALS.filter((item) => item.id !== 'self-hosted')

interface VoiceSettingsProps extends SettingsSectionProps {
  voice: ApexApi['voice'] | null
  platform?: NodeJS.Platform
}

function needsDesktopRestart(error: unknown): boolean {
  return /No handler registered for ['"]voice:/i.test(errorMessage(error))
}

function ModelSelect({ label, description, value, options, onChange }: { label: string; description: string; value: string; options: VoiceOption[]; onChange(value: string): void }) {
  const choices = optionsWithCurrent(options, value)
  const selected = choices.find((option) => option.value === value)
  return (
    <label className={`voice-choice-row ${stylex.props(settingsStyles.voiceChoiceRow, [responsiveStyles.voiceChoiceRow, responsiveLayoutStyles.voiceChoiceRow]).className ?? ""}`}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <span className={`voice-choice-control ${stylex.props(settingsStyles.voiceChoiceControl).className ?? ""}`}>
        <SelectControl label={label} value={value} onChange={(event) => onChange(event.target.value)}>
          {choices.map((option) => <option key={option.value} value={option.value}>{`${option.label}${option.recommended ? ' · Recommended' : ''}`}</option>)}
        </SelectControl>
        {selected ? <small>{selected.detail}</small> : null}
      </span>
    </label>
  )
}

function PathInput({ label, description, placeholder, value, onCommit }: { label: string; description: string; placeholder: string; value: string; onCommit(value: string): void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <label className={`voice-path-field ${stylex.props(settingsStyles.voicePathField, [responsiveStyles.voicePathField, responsiveLayoutStyles.voicePathField]).className ?? ""}`}>
      <span><strong>{label}</strong><small>{description}</small></span>
      <TextInput
        label={label}
        isLabelHidden
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        hasSpellCheck={false}
        onChange={(nextValue) => setDraft(nextValue)}
        onBlur={() => { if (draft !== value) onCommit(draft) }}
      />
    </label>
  )
}

export function VoiceSettings({ settings, onUpdate, voice, platform = 'darwin' }: VoiceSettingsProps) {
  const [snapshot, send] = useMachine(voiceSettingsMachine, {
    input: {
      voiceAvailable: Boolean(voice),
      selfHostedUrl: settings.voiceSelfHostedUrl,
      selfHostedModel: settings.voiceSelfHostedModel,
    },
  })

  const {
    status,
    credential,
    apiKey,
    failure,
    selfHostedUrl,
    selfHostedModel,
    selfHostedMessage,
  } = snapshot.context

  const serviceState = snapshot.matches({ service: 'checking' })
    ? 'checking'
    : snapshot.matches({ service: 'ready' })
      ? 'ready'
      : snapshot.matches({ service: 'restartRequired' })
        ? 'restart-required'
        : 'error'
  const busy = snapshot.matches({ service: { ready: { modalOpen: 'saving' } } }) || snapshot.matches({ service: { ready: 'deleting' } })
  const selfHostedTestState = snapshot.matches({ selfHostedTest: 'testing' })
    ? 'testing'
    : snapshot.matches({ selfHostedTest: 'connected' })
      ? 'connected'
      : snapshot.matches({ selfHostedTest: 'error' })
        ? 'error'
        : 'idle'

  useEffect(() => {
    send({ type: 'SYNC_SELF_HOSTED', url: settings.voiceSelfHostedUrl, model: settings.voiceSelfHostedModel })
  }, [settings.voiceSelfHostedUrl, settings.voiceSelfHostedModel, send])

  useEffect(() => {
    let active = true
    if (!voice) {
      send({ type: 'VOICE_UNAVAILABLE' })
      return
    }
    send({ type: 'CHECK_STATUS' })
    void voice.credentialStatus().then((next) => {
      if (active) send({ type: 'STATUS_LOADED', status: next })
    }).catch((error) => {
      if (!active) return
      if (needsDesktopRestart(error)) send({ type: 'RESTART_REQUIRED' })
      else send({ type: 'STATUS_FAILED', error: errorMessage(error) })
    })
    return () => { active = false }
  }, [voice, send])

  const saveCredential = async () => {
    if (!voice || !credential || !apiKey.trim()) return
    send({ type: 'SAVE_CREDENTIAL' })
    try {
      send({ type: 'SAVE_SUCCEEDED', status: await voice.saveApiKey(credential, apiKey) })
    } catch (error) {
      send({ type: 'SAVE_FAILED', error: errorMessage(error) })
    }
  }

  const removeCredential = async (provider: VoiceCredentialProvider) => {
    if (!voice) return
    send({ type: 'DELETE_CREDENTIAL' })
    try {
      send({ type: 'DELETE_SUCCEEDED', status: await voice.deleteApiKey(provider) })
    } catch (error) {
      send({ type: 'DELETE_FAILED', error: errorMessage(error) })
    }
  }

  const closeCredential = () => { if (!busy) send({ type: 'CLOSE_CREDENTIAL' }) }
  const openCredential = (provider: VoiceCredentialProvider) => { send({ type: 'OPEN_CREDENTIAL', provider }) }
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => { void onUpdate({ [key]: value } as Pick<AppSettings, K>) }
  const testSelfHosted = async () => {
    if (!voice || !selfHostedUrl.trim()) return
    send({ type: 'TEST_SELF_HOSTED' })
    const url = selfHostedUrl.trim()
    const model = selfHostedModel.trim()
    try {
      await voice.testSelfHosted({ url, model })
      await onUpdate({ voiceSelfHostedUrl: url, voiceSelfHostedModel: model })
      send({ type: 'TEST_SUCCEEDED' })
    } catch (error) {
      send({ type: 'TEST_FAILED', error: errorMessage(error) })
    }
  }
  const provider = VOICE_PROVIDER_OPTIONS.find((option) => option.value === settings.voiceTranscriptionProvider) ?? VOICE_PROVIDER_OPTIONS[0]
  const selectedCredential = provider.credential
  const selectedConfigured = selectedCredential ? status?.configured[selectedCredential] ?? false : true
  const secureStorageAvailable = status?.storage.available ?? false

  return (
    <>
      <header className={`voice-settings-header ${stylex.props(settingsStyles.voiceSettingsHeader).className ?? ""}`}>
        <span className={`voice-settings-header__icon ${stylex.props(settingsStyles.voiceSettingsHeaderIcon).className ?? ""}`}><MicrophoneStage size={19} /></span>
        <div><h1>Voice</h1><p>Connect a speech service, choose a model, then use the microphone or realtime orb.</p></div>
      </header>

      {serviceState === 'restart-required' ? (
        <div className={`voice-bridge-notice ${stylex.props(settingsStyles.voiceBridgeNotice, [responsiveStyles.voiceBridgeNotice, responsiveLayoutStyles.voiceBridgeNotice]).className ?? ""}`} role="status">
          <ArrowsClockwise size={17} />
          <span><strong>Restart Apex to finish enabling Voice</strong><small>This app window is connected to an older desktop process without the Voice handlers. Quit Apex completely with {shortcutLabel(platform, ['Primary', 'Q'])}, then reopen it.</small></span>
        </div>
      ) : null}

      <section className={`voice-section ${stylex.props(settingsStyles.voiceSection).className ?? ""}`} aria-labelledby="voice-connections-title">
        <div className={`voice-section__heading ${stylex.props(settingsStyles.voiceSectionHeading).className ?? ""}`}>
          <span><ShieldCheck size={15} /></span>
          <div><h2 id="voice-connections-title">Connections</h2><p>Add a key for any hosted service you want to use. Secure storage keeps keys encrypted between app sessions; otherwise they stay only in memory until Apex quits.</p></div>
        </div>
        {serviceState === 'ready' && status && !secureStorageAvailable ? (
          <Banner
            xstyle={[settingsStyles.voiceStorageNotice]}
            status="warning"
            role="alert"
            className="voice-storage-notice"
            icon={<ShieldWarning size={17} />}
            title="Keys will work only until Apex quits"
            description={`${status.storage.message} You can still add a key for this session. Apex will keep it only in desktop memory and will not save it to disk.`}
          />
        ) : null}
        {voice ? <div className={`voice-connection-grid ${stylex.props(settingsStyles.voiceConnectionGrid).className ?? ""}`}>
          {CONNECTION_CREDENTIALS.map((item) => {
            const configured = status?.configured[item.id] ?? false
            const source = status?.source[item.id]
            return (
              <article className={[`voice-connection-card${configured ? ' is-connected' : ''}`, stylex.props(settingsStyles.voiceConnectionCard, responsiveStyles.voiceConnectionCard).className].filter(Boolean).join(' ')} key={item.id}>
                <span className={`voice-provider-mark ${stylex.props(settingsStyles.voiceProviderMark).className ?? ""}`} aria-hidden="true">{item.monogram}</span>
                <div className={`voice-connection-card__body ${stylex.props(settingsStyles.voiceConnectionCardBody, [responsiveStyles.voiceConnectionCardBody, responsiveLayoutStyles.voiceConnectionCardBody]).className ?? ""}`}>
                  <span className={`voice-connection-card__title ${stylex.props(settingsStyles.voiceConnectionCardTitle).className ?? ""}`}><strong>{item.name}</strong><i>{serviceState === 'checking' ? 'Checking…' : serviceState === 'restart-required' ? 'Restart required' : serviceState === 'error' ? 'Unavailable' : configured ? source === 'environment' ? 'Environment key' : source === 'session' ? 'Session only' : 'Connected' : source === 'saved' && !secureStorageAvailable ? 'Storage locked' : 'Not connected'}</i></span>
                  <small>{item.detail}</small>
                </div>
                {serviceState === 'ready' ? <ApexButton disabled={busy} icon={<Key size={13} />} onClick={() => openCredential(item.id)}>{configured ? 'Replace key' : 'Add key'}</ApexButton> : null}
                {serviceState === 'ready' && (source === 'saved' || source === 'session') ? <IconButton xstyle={[workbenchStyles.button]} className="button button--icon" label={`Remove ${item.name} API key`} disabled={busy} onClick={() => void removeCredential(item.id)}><Trash size={13} /></IconButton> : null}
              </article>
            )
          })}
        </div> : null}
        {failure && !credential ? <Banner xstyle={[inspectorStyles.settingsError]} status="error" role="alert" className="settings-error" title={failure} /> : null}
      </section>

      <section className={`voice-section ${stylex.props(settingsStyles.voiceSection).className ?? ""}`} aria-labelledby="voice-dictation-title">
        <div className={`voice-section__heading ${stylex.props(settingsStyles.voiceSectionHeading).className ?? ""}`}>
          <span><Waves size={15} /></span>
          <div><h2 id="voice-dictation-title">Dictation</h2><p>This controls the microphone beside Send.</p></div>
        </div>
        <div className={`voice-setup-card ${stylex.props(settingsStyles.voiceSetupCard).className ?? ""}`}>
          <label className={`voice-choice-row ${stylex.props(settingsStyles.voiceChoiceRow, [responsiveStyles.voiceChoiceRow, responsiveLayoutStyles.voiceChoiceRow]).className ?? ""}`}>
            <span><strong>Service</strong><small>Choose where your microphone audio is transcribed.</small></span>
            <span className={`voice-choice-control ${stylex.props(settingsStyles.voiceChoiceControl).className ?? ""}`}>
              <SelectControl label="Dictation service" value={settings.voiceTranscriptionProvider} onChange={(event) => update('voiceTranscriptionProvider', event.target.value as VoiceTranscriptionProvider)}>
                {VOICE_PROVIDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{`${option.label}${option.recommended ? ' · Recommended' : ''}`}</option>)}
              </SelectControl>
              <small>{provider.detail}</small>
            </span>
          </label>

          {settings.voiceTranscriptionProvider === 'openai-live' ? <ModelSelect label="Dictation model" description="Streams text while you are speaking." value={settings.voiceOpenAiLiveTranscriptionModel} options={OPENAI_LIVE_MODELS} onChange={(value) => update('voiceOpenAiLiveTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'openai' ? <ModelSelect label="Dictation model" description="Transcribes after you stop recording." value={settings.voiceOpenAiTranscriptionModel} options={OPENAI_FILE_MODELS} onChange={(value) => update('voiceOpenAiTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'groq' ? <ModelSelect label="Dictation model" description="Choose speed or maximum Whisper accuracy." value={settings.voiceGroqTranscriptionModel} options={GROQ_MODELS} onChange={(value) => update('voiceGroqTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'deepgram' ? <ModelSelect label="Dictation model" description="Choose a general or audio-specific Nova model." value={settings.voiceDeepgramTranscriptionModel} options={DEEPGRAM_MODELS} onChange={(value) => update('voiceDeepgramTranscriptionModel', value)} /> : null}
          {settings.voiceTranscriptionProvider === 'self-hosted' ? (
            <div className={`voice-self-hosted-setup ${stylex.props(settingsStyles.voiceSelfHostedSetup).className ?? ""}`}>
              <span className={`voice-local-setup__intro ${stylex.props(settingsStyles.voiceLocalSetupIntro).className ?? ""}`}><HardDrives size={15} /><span><strong>Connect your transcription server</strong><small>Works with Parakeet, Whisper, and other servers that implement the OpenAI transcription API.</small></span></span>
              <label className={`voice-path-field ${stylex.props(settingsStyles.voicePathField, [responsiveStyles.voicePathField, responsiveLayoutStyles.voicePathField]).className ?? ""}`}>
                <span><strong>Server URL</strong><small>Enter the server base URL or its full /v1/audio/transcriptions endpoint.</small></span>
                <TextInput label="Self-hosted server URL" isLabelHidden aria-label="Self-hosted server URL" type="url" value={selfHostedUrl} placeholder="http://127.0.0.1:9000" hasSpellCheck={false} onChange={(nextValue) => send({ type: 'SET_SELF_HOSTED_URL', value: nextValue })} onBlur={() => { const value = selfHostedUrl.trim(); if (value !== settings.voiceSelfHostedUrl) update('voiceSelfHostedUrl', value) }} />
              </label>
              <label className={`voice-path-field ${stylex.props(settingsStyles.voicePathField, [responsiveStyles.voicePathField, responsiveLayoutStyles.voicePathField]).className ?? ""}`}>
                <span><strong>Model ID</strong><small>Optional. Leave blank to ask the server for its default English model.</small></span>
                <TextInput label="Self-hosted model ID" isLabelHidden aria-label="Self-hosted model ID" value={selfHostedModel} placeholder="nvidia/parakeet-tdt-0.6b-v3" hasSpellCheck={false} onChange={(nextValue) => send({ type: 'SET_SELF_HOSTED_MODEL', value: nextValue })} onBlur={() => { const value = selfHostedModel.trim(); if (value !== settings.voiceSelfHostedModel) update('voiceSelfHostedModel', value) }} />
              </label>
              <div className={`voice-self-hosted-auth ${stylex.props(settingsStyles.voiceSelfHostedAuth, [responsiveStyles.voiceSelfHostedAuth, responsiveLayoutStyles.voiceSelfHostedAuth]).className ?? ""}`}>
                <span><strong>Access token</strong><small>Optional. Stored with the same OS-backed protection as your other voice keys.</small></span>
                <span className={`voice-self-hosted-auth__actions ${stylex.props(settingsStyles.voiceSelfHostedAuthActions, responsiveStyles.voiceSelfHostedAuthActions).className ?? ""}`}>
                  <i>{status?.configured['self-hosted'] ? status.source['self-hosted'] === 'session' ? 'Session only' : status.source['self-hosted'] === 'environment' ? 'Environment token' : 'Token saved' : status?.source['self-hosted'] === 'saved' ? 'Storage locked' : 'No token'}</i>
                  {voice && serviceState === 'ready' ? <ApexButton disabled={busy} icon={<Key size={13} />} onClick={() => openCredential('self-hosted')}>{status?.configured['self-hosted'] ? 'Replace token' : 'Add token'}</ApexButton> : null}
                  {voice && serviceState === 'ready' && (status?.source['self-hosted'] === 'saved' || status?.source['self-hosted'] === 'session') ? <IconButton xstyle={[workbenchStyles.button]} className="button button--icon" label="Remove self-hosted access token" disabled={busy} onClick={() => void removeCredential('self-hosted')}><Trash size={13} /></IconButton> : null}
                </span>
              </div>
              <div className={`voice-self-hosted-connect ${stylex.props(settingsStyles.voiceSelfHostedConnect, [responsiveStyles.voiceSelfHostedConnect, responsiveLayoutStyles.voiceSelfHostedAuth]).className ?? ""}`}>
                <span><strong>Connection check</strong><small>Uploads a tenth of a second of silence to verify the actual transcription route and model.</small></span>
                <ApexButton variant="primary" disabled={!voice || !selfHostedUrl.trim() || selfHostedTestState === 'testing'} icon={selfHostedTestState === 'testing' ? <CircleNotch {...stylex.props(styles.spinning)} size={13} /> : <HardDrives size={13} />} onClick={() => void testSelfHosted()}>{selfHostedTestState === 'testing' ? 'Testing…' : 'Connect & test'}</ApexButton>
              </div>
              {selfHostedMessage ? <p className={[`voice-self-hosted-result is-${selfHostedTestState}`, stylex.props(settingsStyles.voiceSelfHostedResult, ((snapshot.matches({
  selfHostedTest: 'testing'
}) ? false : snapshot.matches({
  selfHostedTest: 'connected'
}))) && settingsStyles.voiceSelfHostedResultIsConnected, ((snapshot.matches({
  selfHostedTest: 'testing'
}) ? false : snapshot.matches({
  selfHostedTest: 'connected'
}) ? false : snapshot.matches({
  selfHostedTest: 'error'
}))) && settingsStyles.voiceSelfHostedResultIsError).className].filter(Boolean).join(' ')} role={selfHostedTestState === 'error' ? 'alert' : 'status'}>{selfHostedTestState === 'connected' ? <Check size={13} /> : <ShieldWarning size={13} />}{selfHostedMessage}</p> : null}
              <p className={`voice-self-hosted-note ${stylex.props(settingsStyles.voiceSelfHostedNote).className ?? ""}`}>Plain HTTP is allowed on this computer and private-network addresses. Use HTTPS for public hosts.</p>
            </div>
          ) : null}
          {settings.voiceTranscriptionProvider === 'local-whisper' ? (
            <div className={`voice-local-setup ${stylex.props(settingsStyles.voiceLocalSetup).className ?? ""}`}>
              <span className={`voice-local-setup__intro ${stylex.props(settingsStyles.voiceLocalSetupIntro).className ?? ""}`}><Laptop size={15} /><span><strong>Local whisper.cpp setup</strong><small>These are file paths because Apex runs your installed whisper.cpp directly. Hosted services do not need them.</small></span></span>
              <PathInput label="whisper-cli executable" description="Path to the whisper.cpp command-line program." placeholder="/opt/homebrew/bin/whisper-cli" value={settings.voiceLocalWhisperExecutable} onCommit={(value) => update('voiceLocalWhisperExecutable', value)} />
              <PathInput label="GGML model file" description="Path to the downloaded whisper.cpp model." placeholder="/path/to/ggml-large-v3-turbo.bin" value={settings.voiceLocalWhisperModel} onCommit={(value) => update('voiceLocalWhisperModel', value)} />
            </div>
          ) : null}

          {settings.voiceTranscriptionProvider === 'self-hosted' ? (
            <div className={[`voice-requirement${selfHostedUrl.trim() ? ' is-ready' : ''}`, stylex.props(settingsStyles.voiceRequirement).className].filter(Boolean).join(' ')}>
              <span>{selfHostedUrl.trim() ? <Check size={13} /> : <HardDrives size={13} />}{selfHostedUrl.trim() ? 'Self-hosted server configured' : 'Server URL required'}</span>
            </div>
          ) : selectedCredential ? (
            <div className={[`voice-requirement${selectedConfigured ? ' is-ready' : ''}`, stylex.props(settingsStyles.voiceRequirement).className].filter(Boolean).join(' ')}>
              <span>{selectedConfigured ? <Check size={13} /> : <Key size={13} />}{selectedConfigured ? `${CREDENTIALS.find((item) => item.id === selectedCredential)?.name} is connected` : `${CREDENTIALS.find((item) => item.id === selectedCredential)?.name} key required`}</span>
              {!selectedConfigured && voice && serviceState === 'ready' ? <ApexButton compact onClick={() => openCredential(selectedCredential)}>Add key</ApexButton> : null}
            </div>
          ) : <div className={`voice-requirement is-ready ${stylex.props(settingsStyles.voiceRequirement, settingsStyles.voiceRequirementIsReady).className ?? ""}`}><span><Check size={13} />Runs locally with no API key</span></div>}
        </div>
      </section>

      <section className={`voice-section ${stylex.props(settingsStyles.voiceSection).className ?? ""}`} aria-labelledby="voice-realtime-title">
        <div className={`voice-section__heading ${stylex.props(settingsStyles.voiceSectionHeading).className ?? ""}`}>
          <span><Broadcast size={15} /></span>
          <div><h2 id="voice-realtime-title">Realtime orb</h2><p>The draggable voice agent. It uses your OpenAI connection.</p></div>
        </div>
        <div className={`voice-setup-card ${stylex.props(settingsStyles.voiceSetupCard).className ?? ""}`}>
          <ModelSelect label="Realtime model" description="Handles conversation, web search, and task delegation." value={settings.voiceRealtimeModel} options={REALTIME_MODELS} onChange={(value) => update('voiceRealtimeModel', value)} />
          <ModelSelect label="Speaking voice" description="The voice you hear when the orb responds." value={settings.voiceRealtimeVoice} options={REALTIME_VOICES} onChange={(value) => update('voiceRealtimeVoice', value)} />
          <div className={[`voice-requirement${status?.configured.openai ? ' is-ready' : ''}`, stylex.props(settingsStyles.voiceRequirement).className].filter(Boolean).join(' ')}>
            <span>{status?.configured.openai ? <Check size={13} /> : <Key size={13} />}{status?.configured.openai ? 'OpenAI is connected' : 'OpenAI key required'}</span>
            {!status?.configured.openai && voice && serviceState === 'ready' ? <ApexButton compact onClick={() => openCredential('openai')}>Add key</ApexButton> : null}
          </div>
          {secureStorageAvailable ? <p className={`voice-realtime-note ${stylex.props(settingsStyles.voiceRealtimeNote).className ?? ""}`}>Saved API keys are encrypted using your operating system’s internal keychain. When you open the voice agent, your system may ask for your password to retrieve the key.</p> : null}
        </div>
      </section>

      <AnimatePresence initial={false}>
        {credential ? <Modal key={`voice-credential:${credential}`} title={`Connect ${CREDENTIALS.find((item) => item.id === credential)?.name ?? credential}`} onClose={closeCredential} footer={<><ApexButton variant="quiet" disabled={busy} onClick={closeCredential}>Cancel</ApexButton><ApexButton variant="primary" disabled={busy || !apiKey.trim()} onClick={() => void saveCredential()}>{busy ? 'Saving…' : credential === 'self-hosted' ? 'Save token' : 'Save API key'}</ApexButton></>}>
          <p className={`modal-intro ${stylex.props(overlaysStyles.modalIntro).className ?? ""}`}>{secureStorageAvailable ? `Paste the ${credential === 'self-hosted' ? 'optional bearer token' : 'provider API key'}. Apex encrypts it with your operating system’s secure credential store and never reads it back into this screen.` : `Secure credential storage is unavailable. Apex will keep this ${credential === 'self-hosted' ? 'token' : 'key'} only in desktop memory for the current app session. It will not write the ${credential === 'self-hosted' ? 'token' : 'key'} to disk, and it will be cleared when Apex quits.`}</p>
          {failure ? <Banner xstyle={[inspectorStyles.settingsError]} status="error" role="alert" className="settings-error" title={failure} /> : null}
          <TextInput
            label={credential === 'self-hosted' ? 'Access token' : 'API key'}
            hasAutoFocus
            type="password"
            value={apiKey}
            autoComplete="off"
            hasSpellCheck={false}
            placeholder={credential === 'self-hosted' ? 'Paste access token' : 'Paste API key'}
            containerClassName="field"
            onChange={(nextValue) => send({ type: 'SET_API_KEY', value: nextValue })}
          />
        </Modal> : null}
      </AnimatePresence>
    </>
  )
}
