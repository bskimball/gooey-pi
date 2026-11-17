import { useLayoutEffect, type ReactNode } from 'react'
import vscodeCss from '../packages/vscode/webview/apex.css?inline'

const tokens = {
  'editor-background': ['#ffffff', '#1f1f1f'],
  'sideBar-background': ['#f8f8f8', '#181818'],
  'editorWidget-background': ['#f3f3f3', '#252526'],
  foreground: ['#3b3b3b', '#cccccc'],
  descriptionForeground: ['#616161', '#9d9d9d'],
  'list-hoverBackground': ['#e8e8e8', '#2a2d2e'],
  'list-inactiveSelectionBackground': ['#e4e6f1', '#37373d'],
  'input-background': ['#ffffff', '#313131'],
  'input-border': ['#cecece', '#3c3c3c'],
  'widget-border': ['#d4d4d4', '#454545'],
  focusBorder: ['#0090f1', '#007fd4'],
  'textLink-foreground': ['#006ab1', '#3794ff'],
  'button-background': ['#0078d4', '#0078d4'],
  'button-foreground': ['#ffffff', '#ffffff'],
  'testing-iconPassed': ['#388a34', '#73c991'],
  'editorWarning-foreground': ['#bf8803', '#cca700'],
  'editorError-foreground': ['#e51400', '#f14c4c'],
  'widget-shadow': ['rgba(0, 0, 0, 0.16)', 'rgba(0, 0, 0, 0.36)'],
} satisfies Record<string, [string, string]>

/** Load the actual webview overrides only while a VS Code story is mounted. */
export function VSCodeTheme({ dark, children }: { dark: boolean; children: ReactNode }) {
  useLayoutEffect(() => {
    const body = document.body
    const previousClasses = Array.from(body.classList).filter((name) => name.startsWith('vscode-'))
    body.classList.remove(...previousClasses)
    const themeClass = dark ? 'vscode-dark' : 'vscode-light'
    body.classList.add(themeClass)
    const previousTokens = Object.keys(tokens).map((name) => {
      const property = `--vscode-${name}`
      return { property, value: body.style.getPropertyValue(property), priority: body.style.getPropertyPriority(property) }
    })
    for (const [name, values] of Object.entries(tokens)) body.style.setProperty(`--vscode-${name}`, values[dark ? 1 : 0])
    return () => {
      body.classList.remove(themeClass)
      body.classList.add(...previousClasses)
      for (const { property, value, priority } of previousTokens) {
        if (value) body.style.setProperty(property, value, priority)
        else body.style.removeProperty(property)
      }
    }
  }, [dark])
  return (
    <>
      <style>{vscodeCss}</style>
      {children}
    </>
  )
}
