import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { PetAvatar, type PetActivity } from '../../apps/desktop/src/components/PetAvatar'
import { DesktopPet } from '../../apps/desktop/src/components/DesktopPet'
import { VoiceOrb } from '../../apps/desktop/src/components/VoiceOrb'
import { installVoiceScene } from './voice-media'
import { click } from './interactions'
import { pets, orb, spritePet, succeed, voiceFixture } from './fixtures'

function Avatar({
  activity = 'idle',
  sprite = false,
  failed = false,
  size = 92,
  reduceMotion = true,
}: {
  activity?: PetActivity
  sprite?: boolean
  failed?: boolean
  size?: number
  reduceMotion?: boolean
}) {
  return <PetAvatar pet={sprite ? spritePet : orb} pets={failed ? { ...pets, sprite: async () => null } : pets} activity={activity} size={size} reduceMotion={reduceMotion} />
}
const config = {
  title: 'Workspace/Pets and voice',
  component: Avatar,
  args: { activity: 'idle', sprite: false, failed: false, size: 92, reduceMotion: true },
  argTypes: {
    activity: { control: 'select', options: ['idle', 'running-left', 'running-right', 'speaking', 'working', 'waiting', 'jumping', 'failed'] },
    size: { control: { type: 'range', min: 32, max: 160 } },
  },
} satisfies Meta<typeof Avatar>
export default config
type Story = StoryObj<typeof config>
export const Orb: Story = {}
export const Sprite: Story = { args: { sprite: true } }
export const SpriteUnavailable: Story = { args: { sprite: true, failed: true } }
export const ActivityGallery: Story = {
  render: () => (
    <>
      {(['idle', 'running-left', 'running-right', 'speaking', 'working', 'waiting', 'jumping', 'failed'] satisfies PetActivity[]).map((activity) => (
        <figure key={activity}>
          <Avatar activity={activity} />
          <Avatar activity={activity} sprite />
          <figcaption>{activity}</figcaption>
        </figure>
      ))}
    </>
  ),
}
function Companion({ busy = false, voice = false, error = false }: { busy?: boolean; voice?: boolean; error?: boolean }) {
  const [visible, setVisible] = useState(true)
  const [active, setActive] = useState(voice)
  const [muted, setMuted] = useState(false)
  return (
    <>
      {visible ? (
        <DesktopPet
          pets={pets}
          petId="orb"
          agentBusy={busy}
          voiceActive={active}
          reduceMotion
          voiceActivity={muted ? 'waiting' : 'speaking'}
          voiceMuted={muted}
          voiceStatus={muted ? 'Microphone muted' : 'Listening'}
          voiceError={error ? 'Offline voice connection failed.' : undefined}
          onOpenVoice={() => setActive(true)}
          onToggleVoiceMute={() => setMuted((value) => !value)}
          onCloseVoice={() => setActive(false)}
          onDismiss={() => setVisible(false)}
        />
      ) : (
        <button type="button" onClick={() => setVisible(true)}>
          Restore companion
        </button>
      )}
    </>
  )
}
export const DesktopCompanion: Story = { render: () => <Companion /> }
export const DesktopBusy: Story = { render: () => <Companion busy /> }
export const DesktopVoiceControls: Story = { render: () => <Companion voice /> }
export const DesktopVoiceError: Story = { render: () => <Companion voice error /> }
function SafeVoice({ withPet = false }: { withPet?: boolean }) {
  const [voice] = useState(() => ({ ...voiceFixture(), createRealtimeCall: async () => 'offline-story-answer' }))
  const [open, setOpen] = useState(true)
  return open ? (
    <VoiceOrb voice={voice} harness="pi" pet={withPet ? { pets, petId: 'orb', agentBusy: false, reduceMotion: true } : undefined} onClose={() => setOpen(false)} onTaskStarted={succeed} />
  ) : (
    <p>Voice closed.</p>
  )
}
export const VoiceConnectionError: Story = { beforeEach: () => installVoiceScene('error'), render: () => <SafeVoice /> }
export const VoiceConnecting: Story = { beforeEach: () => installVoiceScene('connecting'), render: () => <SafeVoice /> }
export const VoiceListening: Story = { beforeEach: () => installVoiceScene('listening'), render: () => <SafeVoice /> }
export const VoiceSpeaking: Story = { beforeEach: () => installVoiceScene('speaking'), render: () => <SafeVoice /> }
export const VoiceMuted: Story = { beforeEach: () => installVoiceScene('listening'), render: () => <SafeVoice />, play: async ({ canvasElement }) => click(canvasElement, 'Mute realtime voice') }
export const VoiceWithPet: Story = { beforeEach: () => installVoiceScene('speaking'), render: () => <SafeVoice withPet /> }
