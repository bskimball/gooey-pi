import type { ITheme } from '@xterm/xterm'

export const terminalTheme = (): ITheme => {
  const computed = getComputedStyle(document.documentElement)
  const read = (name: string, fallback: string) => computed.getPropertyValue(name).trim() || fallback
  return {
    background: read('--terminal-bg', '#ffffff'),
    foreground: read('--terminal-text', '#20201e'),
    cursor: read('--apex', '#6b55e8'),
    selectionBackground: read('--terminal-selection', '#c8beff99'),
    black: read('--terminal-black', '#242423'),
    red: read('--terminal-red', '#b42318'),
    green: read('--terminal-green', '#18794e'),
    yellow: read('--terminal-yellow', '#8a5a00'),
    blue: read('--terminal-blue', '#2768b4'),
    magenta: read('--terminal-magenta', '#7b4bb7'),
    cyan: read('--terminal-cyan', '#197a7d'),
    white: read('--terminal-white', '#686863'),
    brightBlack: read('--terminal-bright-black', '#8b8b83'),
    brightRed: read('--terminal-bright-red', '#b42318'),
    brightGreen: read('--terminal-bright-green', '#18794e'),
    brightYellow: read('--terminal-bright-yellow', '#8a5a00'),
    brightBlue: read('--terminal-bright-blue', '#2768b4'),
    brightMagenta: read('--terminal-bright-magenta', '#7046a3'),
    brightCyan: read('--terminal-bright-cyan', '#177f83'),
    brightWhite: read('--terminal-bright-white', '#20201e'),
  }
}
