import * as stylex from '@stylexjs/stylex'

export const styles = stylex.create({
  "sourceParagraph": {
    "marginTop": "0",
    "marginRight": "0",
    "marginBottom": "0",
    "marginLeft": "0",
    "color": "var(--text-secondary)",
    "fontSize": "var(--fs-meta)",
    "lineHeight": "1.45"
  },
  "sourceCode": {
    "whiteSpace": "normal",
    "color": "var(--text)"
  },
  "sourceAlert": {
    "color": "var(--danger)"
  },
  "popoverWithSource": {
    "top": "12px",
    "maxHeight": "calc(100% - 24px)",
    "overflowY": "auto"
  },
  "commentFocus": {
    "outlineWidth": {
      "default": "0px",
      ":focus-visible": "2px"
    },
    "outlineStyle": {
      "default": "none",
      ":focus-visible": "solid"
    },
    "outlineColor": {
      "default": "currentColor",
      ":focus-visible": "var(--annotation)"
    },
    "outlineOffset": {
      "default": "0px",
      ":focus-visible": "1px"
    }
  },
  "sourceButton": {
    "justifySelf": "start",
    "minHeight": "32px"
  },
  "popoverButton": {
    "minHeight": "26px",
    "fontSize": "var(--fs-meta)"
  }
})
