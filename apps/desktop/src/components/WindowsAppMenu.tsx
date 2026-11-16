import * as stylex from '@stylexjs/stylex'
import { styles as baseStyles } from 'apex-ui/styles/base.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { styles as sidebarStyles } from 'apex-ui/styles/sidebar.stylex'
import { DropdownMenu } from '@astryxdesign/core/DropdownMenu'
import { useRef, useState } from 'react'
import type { ApplicationMenuName } from '@/types/api'
import { IconButton, PiMark } from './ui'

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
    <div ref={triggerWrapRef} className={`windows-app-menu no-drag ${stylex.props(baseStyles.noDrag, workbenchStyles.windowsAppMenu).className ?? ""}`}>
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
            xstyle={sidebarStyles.brandMenuButton}
            className={open ? 'is-active' : ''}
            label="Application menu"
          >
            <PiMark size={24} />
          </IconButton>
        )}
      />
    </div>
  )
}

export default WindowsAppMenu
