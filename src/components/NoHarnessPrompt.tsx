import { Modal } from './ui'

export function NoHarnessPrompt({ onClose, onOpenHarnessSettings }: { onClose(): void; onOpenHarnessSettings(): void }) {
  return (
    <Modal
      title="Pi not detected"
      onClose={onClose}
      footer={<button type="button" className="button button--primary" onClick={onOpenHarnessSettings}>Take me there</button>}
    >
      <p>Apex couldn’t find Pi. Install Pi to get started.</p>
      <p>If Pi is already installed, configure its executable path in Pi settings. You can also refresh detection there after installing Pi.</p>
    </Modal>
  )
}
