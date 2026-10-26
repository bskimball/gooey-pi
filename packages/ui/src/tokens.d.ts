export interface ThemeAnsiPalette {
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

export interface ThemePalette {
  canvas: string
  sidebar: string
  surface: string
  hover: string
  selected: string
  raised: string
  text: string
  text2: string
  text3: string
  border: string
  borderSubtle: string
  borderStrong: string
  focus: string
  prime: string
  primeSoft: string
  success: string
  warning: string
  danger: string
  diffAdd: string
  diffAddLine: string
  diffRemove: string
  diffRemoveLine: string
  termBg: string
  termText: string
  termSelection: string
  ansi: ThemeAnsiPalette
  onPrime: string
  shadow: string
}

export declare const palettes: {
  dark: ThemePalette
  light: ThemePalette
}
