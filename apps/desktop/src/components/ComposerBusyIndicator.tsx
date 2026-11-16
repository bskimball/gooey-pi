import * as stylex from '@stylexjs/stylex'
import { useEffect, useState } from 'react'
import { styles } from './composer.stylex'

export function ComposerBusyIndicator() {
  const [reducedMotion, setReducedMotion] = useState(() => document.documentElement.classList.contains('reduce-motion'))
  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => setReducedMotion(root.classList.contains('reduce-motion')))
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return (
    <>
      <span aria-hidden="true" {...stylex.props(styles.halo)} />
      <span aria-hidden="true" {...stylex.props(styles.ribbon, reducedMotion && styles.reducedRibbon)} />
    </>
  )
}
