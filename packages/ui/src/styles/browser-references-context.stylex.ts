import * as stylex from '@stylexjs/stylex'

export const styles = stylex.create({
  "trayHeadingButton": {
    "paddingTop": "4px",
    "paddingRight": "6px",
    "paddingBottom": "4px",
    "paddingLeft": "6px",
    "color": "var(--text-secondary)",
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)"
  },
  "trayParagraph": {
    "marginTop": "0",
    "marginRight": "0",
    "marginBottom": "6px",
    "marginLeft": "0",
    "color": "var(--text-secondary)",
    "fontSize": "var(--fs-meta)"
  },
  "cardHeader": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "4px",
    "columnGap": "4px"
  },
  "targetIcon": {
    "flexGrow": "0",
    "flexShrink": "0",
    "flexBasis": "auto"
  },
  "targetLabel": {
    "overflowX": "hidden",
    "overflowY": "hidden",
    "textOverflow": "ellipsis",
    "whiteSpace": "nowrap"
  },
  "headerTarget": {
    "flexGrow": "1",
    "flexShrink": "1",
    "flexBasis": "0%"
  },
  "headerLastButton": {
    "display": "grid",
    "width": "28px",
    "height": "28px",
    "flexGrow": "0",
    "flexShrink": "0",
    "flexBasis": "28px",
    "placeItems": "center",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "color": {
      "default": "var(--text-tertiary)",
      ":hover": "var(--text)"
    },
    "backgroundColor": {
      "default": "transparent",
      ":hover": "var(--surface-hover)"
    },
    "backgroundImage": {
      "default": "none",
      ":hover": "none"
    },
    "backgroundPosition": {
      "default": "0% 0%",
      ":hover": "0% 0%"
    },
    "backgroundSize": {
      "default": "auto auto",
      ":hover": "auto auto"
    },
    "backgroundRepeat": {
      "default": "repeat",
      ":hover": "repeat"
    },
    "backgroundAttachment": {
      "default": "scroll",
      ":hover": "scroll"
    },
    "backgroundOrigin": {
      "default": "padding-box",
      ":hover": "padding-box"
    },
    "backgroundClip": {
      "default": "border-box",
      ":hover": "border-box"
    },
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
      ":focus-visible": "var(--focus)"
    },
    "outlineOffset": {
      "default": "0px",
      ":focus-visible": "2px"
    }
  },
  "imagePreviewFocus": {
    "outlineWidth": { "default": "medium", ":focus-visible": "2px" },
    "outlineStyle": { "default": "none", ":focus-visible": "solid" },
    "outlineColor": { "default": "currentColor", ":focus-visible": "var(--focus)" },
    "outlineOffset": { "default": "0px", ":focus-visible": "2px" }
  },
  "trayPreview": {
    "width": "100%",
    "height": "72px"
  },
  "trayImage": {
    "width": "100%",
    "height": "72px"
  },
  "referenceSmall": {
    "display": "block",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "color": "var(--text-tertiary)",
    "fontSize": "var(--fs-micro)",
    "textOverflow": "ellipsis",
    "whiteSpace": "nowrap"
  },
  "cardDetails": {
    "marginTop": "5px",
    "fontSize": "var(--fs-micro)"
  },
  "cardSummary": {
    "color": "var(--text-secondary)",
    "cursor": "pointer",
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
      ":focus-visible": "var(--focus)"
    },
    "outlineOffset": {
      "default": "0px",
      ":focus-visible": "2px"
    }
  },
  "cardDetailText": {
    "display": "block",
    "marginTop": "6px",
    "marginRight": "0",
    "marginBottom": "0",
    "marginLeft": "0",
    "overflowWrap": "anywhere",
    "whiteSpace": "normal"
  },
  "referenceParagraph": {
    "marginTop": "7px",
    "marginRight": "0",
    "marginBottom": "0",
    "marginLeft": "0",
    "fontSize": "var(--fs-meta)"
  },
  "targetEnabled": {
    "display": "flex",
    "minWidth": 0,
    "alignItems": "center",
    "rowGap": "5px",
    "columnGap": "5px",
    "paddingTop": "2px",
    "paddingRight": 0,
    "paddingBottom": "2px",
    "paddingLeft": 0,
    "color": {
      "default": "var(--text-secondary)",
      ":hover": "var(--text)"
    },
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "var(--fs-meta)",
    "textAlign": "left",
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
      ":focus-visible": "var(--focus)"
    },
    "outlineOffset": {
      "default": "0px",
      ":focus-visible": "2px"
    }
  },
  "targetDisabled": {
    "display": "flex",
    "minWidth": 0,
    "alignItems": "center",
    "rowGap": "5px",
    "columnGap": "5px",
    "paddingTop": "2px",
    "paddingRight": 0,
    "paddingBottom": "2px",
    "paddingLeft": 0,
    "color": "var(--text-secondary)",
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "var(--fs-meta)",
    "textAlign": "left",
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
      ":focus-visible": "var(--focus)"
    },
    "outlineOffset": {
      "default": "0px",
      ":focus-visible": "2px"
    }
  }
})
