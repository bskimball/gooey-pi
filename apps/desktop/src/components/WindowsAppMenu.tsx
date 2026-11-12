import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { useRef, useState } from 'react'
import type { ApplicationMenuName } from '@/types/api'
import { DotsThree } from './icons'
import { IconButton } from './ui'

const windowsMenus: ReadonlyArray<{ name: ApplicationMenuName; label: string }> = [
  { name: 'file', label: 'File' },
  { name: 'edit', label: 'Edit' },
  { name: 'view', label: 'View' },
  { name: 'window', label: 'Window' },
  { name: 'help', label: 'Help' },
]

/** Windows keeps File/Edit/View behind one quiet button instead of a permanent menu row. */
export function WindowsAppMenu() {
  const [open, setOpen] = useState(false)
  const triggerWrapRef = useRef<HTMLDivElement>(null)

  const openApplicationMenu = (menu: ApplicationMenuName) => {
    const rect = triggerWrapRef.current?.getBoundingClientRect()
    void window.apex?.app.popupMenu?.(menu, (rect?.right ?? 0) + 4, rect?.top ?? 0).catch(() => undefined)
  }

  return (
    <div ref={triggerWrapRef} className="windows-app-menu no-drag">
      <DropdownMenu
        presentation="popover"
        placement="below"
        alignment="start"
        isMenuOpen={open}
        onOpenChange={setOpen}
        items={windowsMenus.map(({ name, label }) => ({
          id: name,
          label,
          onClick: () => openApplicationMenu(name),
        }))}
        renderTrigger={(triggerProps) => (
          <IconButton
            {...triggerProps}
            className={open ? 'is-active' : ''}
            label="Application menu"
          >
            <DotsThree size={18} />
          </IconButton>
        )}
      />
    </div>
  )
}

export default WindowsAppMenu
