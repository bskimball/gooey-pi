import { motionMarker } from "./motion.stylex";
import * as stylex from '@stylexjs/stylex';
const welcomeCrestAnimation = stylex.keyframes({
  "0%": {
    transform: "translateY(2px)"
  },
  "100%": {
    transform: "translateY(2px)"
  },
  "50%": {
    transform: "translateY(-2.5px)"
  }
});
const welcomeMarkInAnimation = stylex.keyframes({
  from: {
    opacity: "0",
    transform: "translateY(6px) scale(.92)"
  }
});
const welcomeSwellAnimation = stylex.keyframes({
  "0%": {
    "transform": "translate(-3px, 1px)"
  },
  "100%": {
    "transform": "translate(-3px, 1px)"
  },
  "50%": {
    "transform": "translate(3px, -2px)"
  }
});
const welcomeMoonAnimation = stylex.keyframes({
  "0%": {
    "opacity": 0.7,
    "transform": "scale(.96)"
  },
  "100%": {
    "opacity": 0.7,
    "transform": "scale(.96)"
  },
  "50%": {
    "opacity": 1,
    "transform": "scale(1.05)"
  }
});
const welcomeSprayAnimation = stylex.keyframes({
  "0%": {
    "opacity": 0,
    "transform": "translateY(3px)"
  },
  "25%": {
    "opacity": 1
  },
  "60%": {
    "opacity": 0,
    "transform": "translateY(-5px)"
  },
  "100%": {
    "opacity": 0,
    "transform": "translateY(-5px)"
  }
});
const welcomeRingAnimation = stylex.keyframes({
  "to": {
    "transform": "rotate(360deg)"
  }
});
export const styles = stylex.create({
  "appShell": {
    "display": "flex",
    "width": "100%",
    "height": "100%",
    "minWidth": 0,
    "backgroundColor": "var(--canvas)",
    "backgroundImage": "radial-gradient(110% 65% at 50% 0%, var(--canvas-glow), transparent 72%)",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "isolation": "isolate"
  },
  "workbench": {
    "position": "relative",
    "display": "flex",
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "auto",
    "minWidth": 0,
    "height": "100%",
    "flexDirection": "column"
  },
  "titleToolbar": {
    "display": "flex",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "52px",
    "minWidth": 0,
    "alignItems": "center",
    "rowGap": "12px",
    "columnGap": "12px",
    "paddingTop": 0,
    "paddingInlineEnd": "17px",
    "paddingBottom": 0,
    "paddingLeft": "17px",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--edge)",
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "var(--shadow-toolbar)",
    "position": "relative",
    "zIndex": 15
  },
  "titleToolbarWindowControls": {
    "paddingInlineEnd": "max(14px, calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 14px))"
  },
  "trafficLightClearance": {
    "width": "66px",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "66px"
  },
  "trafficLightClearanceToolbar": {
    "width": "62px",
    "flexBasis": "62px"
  },
  "windowsAppMenu": {
    "position": "relative"
  },
  "titleToolbarNav": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "2px",
    "columnGap": "2px"
  },
  "titleToolbarActions": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "2.5px",
    "columnGap": "2.5px",
    "justifyContent": "flex-end"
  },
  "titleToolbarIdentity": {
    "minWidth": 0,
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "0%",
    "display": "flex",
    "alignItems": "center",
    "justifyContent": "flex-start",
    "rowGap": "7px",
    "columnGap": "7px"
  },
  "titleChromeButton": {
    "width": { "default": "32px", "@media (max-width: 720px)": "36px" },
    "height": { "default": "32px", "@media (max-width: 720px)": "36px" }
  },
  "projectRunControl": {
    "position": "relative",
    "marginRight": "3px"
  },
  "projectRunSplit": {
    "height": { "default": "32px", "@media (max-width: 720px)": "36px" },
    "display": "inline-flex",
    "alignItems": "center",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "transparent",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "transparent",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "transparent",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "transparent",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
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
    "transition": "border-color var(--fast), background var(--fast)"
  },
  "projectRunSplitIsRunning": {
    "borderTopColor": "var(--border)",
    "borderRightColor": "var(--border)",
    "borderBottomColor": "var(--border)",
    "borderLeftColor": "var(--border)",
    "backgroundColor": "var(--surface-selected)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "projectRunSplitPrimary": {
    "width": "32px",
    "height": { "default": "30px", "@media (max-width: 720px)": "34px" }
  },
  "projectRunSplitMenu": {
    "width": "22px",
    "height": { "default": "30px", "@media (max-width: 720px)": "34px" },
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "transparent"
  },
  "projectRunMenu": {
    "position": "absolute",
    "zIndex": 90,
    "top": "calc(100% + 8px)",
    "right": 0,
    "width": "min(360px, calc(100vw - 24px))",
    "display": "grid",
    "rowGap": "13px",
    "columnGap": "13px",
    "paddingTop": "12px",
    "paddingRight": "12px",
    "paddingBottom": "12px",
    "paddingLeft": "12px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "var(--border-strong)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "var(--border-strong)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border-strong)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "var(--border-strong)",
    "borderTopLeftRadius": "var(--radius-lg)",
    "borderTopRightRadius": "var(--radius-lg)",
    "borderBottomRightRadius": "var(--radius-lg)",
    "borderBottomLeftRadius": "var(--radius-lg)",
    "color": "var(--text)",
    "backgroundColor": "var(--surface-raised)",
    "backgroundImage": "var(--gradient-apex)",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "var(--shadow-elevation-med)",
    "cursor": "default"
  },
  "projectRunMenuStatus": {
    "minHeight": "22px",
    "display": "inline-flex",
    "alignItems": "center",
    "rowGap": "5px",
    "columnGap": "5px",
    "justifySelf": "start",
    "marginTop": "-7px",
    "paddingTop": 0,
    "paddingRight": "6px",
    "paddingBottom": 0,
    "paddingLeft": "6px",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "color": "var(--text-tertiary)",
    "backgroundColor": "var(--surface-subtle)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "var(--fs-micro)"
  },
  "projectRunMenuStatusIsRunning": {
    "color": "var(--apex)",
    "backgroundColor": "var(--apex-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "projectRunMenuStatusIsSuccess": {
    "color": "var(--success)",
    "backgroundColor": "var(--success-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "projectRunMenuStatusIsError": {
    "color": "var(--danger)",
    "backgroundColor": "var(--danger-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "projectRunMenuError": {
    "marginTop": "-4px",
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": 0,
    "color": "var(--danger)",
    "fontSize": "var(--fs-micro)",
    "lineHeight": 1.4
  },
  "projectRunMenuItem": {
    "display": "flex",
    "alignItems": "center",
    "justifyContent": "space-between",
    "padding": "8px 12px",
    "borderRadius": "var(--radius-md)",
    "color": "var(--text)",
    "backgroundColor": { "default": "transparent", ":hover": "var(--surface-hover)" },
    "cursor": "pointer",
    "transition": "background var(--fast)"
  },
  "projectRunMenuItemText": {
    "display": "flex",
    "flexDirection": "column",
    "alignItems": "flex-start",
    "rowGap": "2px"
  },
  "projectRunMenuItemMono": {
    "fontSize": "var(--fs-micro)",
    "color": "var(--text-tertiary)",
    "fontFamily": "var(--font-mono)"
  },
  "projectRunMenuItemCheck": {
    "color": "var(--apex)"
  },
  "buttonQuiet": {
    "color": "var(--text-secondary)",
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "borderTopColor": "transparent",
    "borderRightColor": "transparent",
    "borderBottomColor": "transparent",
    "borderLeftColor": "transparent",
    "boxShadow": {
      "default": "none",
      ":hover": "none"
    },
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "branchPill": {
    "height": "24px",
    "maxWidth": "180px",
    "display": "inline-flex",
    "alignItems": "center",
    "rowGap": "5px",
    "columnGap": "5px",
    "paddingTop": 0,
    "paddingRight": "8px",
    "paddingBottom": 0,
    "paddingLeft": "8px",
    "color": "var(--text-secondary)",
    "backgroundColor": "color-mix(in srgb, var(--apex-soft) 28%, var(--surface-subtle))",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--apex) 20%, var(--border))",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--apex) 20%, var(--border))",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--apex) 20%, var(--border))",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--apex) 20%, var(--border))",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "fontSize": "var(--fs-ui)",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "whiteSpace": "nowrap",
    "textOverflow": "ellipsis"
  },
  workspacePage: { display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0 },
  "workbenchContent": {
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "0%",
    "minHeight": 0,
    "minWidth": 0
  },
  "sessionWorkspace": {
    "display": "flex",
    "height": "100%",
    "minHeight": 0,
    "minWidth": 0
  },
  "conversationColumn": {
    "position": "relative",
    "display": "flex",
    "minHeight": 0,
    "minWidth": 0,
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "auto",
    "flexDirection": "column"
  },
  "conversationPane": {
    "position": "relative",
    "display": "flex",
    "flexDirection": "column",
    "minWidth": "360px",
    "minHeight": 0,
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "auto",
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "containerType": "inline-size"
  },
  "conversationBottomDock": {
    "maxWidth": "var(--transcript-measure)",
    "marginTop": 0,
    "marginRight": "auto",
    "marginBottom": 0,
    "marginLeft": "auto",
    "position": "relative",
    "top": "auto",
    "right": "auto",
    "bottom": "auto",
    "left": "auto",
    "zIndex": 10,
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "width": "100%",
    "display": "flex",
    "flexDirection": "column",
    "rowGap": "10px",
    "columnGap": "10px",
    "paddingTop": 0,
    "paddingRight": { "default": "28px", "@media (max-width: 720px)": "24px" },
    "paddingBottom": "14px",
    "paddingLeft": { "default": "28px", "@media (max-width: 720px)": "24px" },
    "pointerEvents": "auto"
  },
  "transcriptChangesPin": {
    "maxWidth": "var(--transcript-measure)",
    "marginTop": 0,
    "marginRight": "auto",
    "marginBottom": 0,
    "marginLeft": "auto",
    "position": "absolute",
    "top": "auto",
    "right": "24px",
    "bottom": "13px",
    "left": "24px",
    "zIndex": 10
  },
  "transcriptInner": {
    "maxWidth": "var(--transcript-measure)",
    "marginTop": 0,
    "marginRight": "auto",
    "marginBottom": 0,
    "marginLeft": "auto"
  },
  "composerWrap": {
    "maxWidth": "var(--transcript-measure)",
    "marginTop": 0,
    "marginRight": "auto",
    "marginBottom": 0,
    "marginLeft": "auto",
    "position": "absolute",
    "top": "auto",
    "right": "24px",
    "bottom": "13px",
    "left": "24px",
    "zIndex": 10
  },
  "composerWrapDocked": {
    "position": "relative",
    "top": "auto",
    "right": { "default": "auto", "@media (max-width: 720px)": "9px" },
    "bottom": { "default": "auto", "@media (max-width: 720px)": "8px" },
    "left": { "default": "auto", "@media (max-width: 720px)": "9px" },
    "width": { "default": "100%", "@media (max-width: 720px)": "calc(100% - 18px)" },
    "marginTop": 0,
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": 0
  },
  "runtimeOwnerNotice": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "8px",
    "columnGap": "8px",
    "paddingTop": "8px",
    "paddingRight": "11px",
    "paddingBottom": "8px",
    "paddingLeft": "11px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "var(--border)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "var(--border)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "var(--border)",
    "borderTopLeftRadius": "var(--radius-lg)",
    "borderTopRightRadius": "var(--radius-lg)",
    "borderBottomRightRadius": "var(--radius-lg)",
    "borderBottomLeftRadius": "var(--radius-lg)",
    "color": "var(--text-secondary)",
    "backgroundColor": "var(--surface-subtle)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "var(--fs-ui)",
    "lineHeight": 1.4
  },
  "changedFiles": {
    "marginTop": 0,
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": 0,
    "paddingTop": 0,
    "paddingRight": 0,
    "paddingBottom": 0,
    "paddingLeft": 0,
    "listStyle": "none"
  },
  "changedFilesRow": {
    "minHeight": "26px",
    "display": "flex",
    "alignItems": "center",
    "rowGap": "7px",
    "columnGap": "7px",
    "paddingTop": 0,
    "paddingRight": "6px",
    "paddingBottom": 0,
    "paddingLeft": "6px",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "fontSize": "var(--fs-meta)",
    "backgroundColor": {
      "default": null,
      ":hover": "var(--surface-subtle)"
    },
    "backgroundImage": {
      "default": null,
      ":hover": "none"
    },
    "backgroundPosition": {
      "default": null,
      ":hover": "0% 0%"
    },
    "backgroundSize": {
      "default": null,
      ":hover": "auto auto"
    },
    "backgroundRepeat": {
      "default": null,
      ":hover": "repeat"
    },
    "backgroundAttachment": {
      "default": null,
      ":hover": "scroll"
    },
    "backgroundOrigin": {
      "default": null,
      ":hover": "padding-box"
    },
    "backgroundClip": {
      "default": null,
      ":hover": "border-box"
    }
  },
  "changedFilesStatus": {
    "width": "16px",
    "height": "16px",
    "display": "inline-grid",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "16px",
    "placeItems": "center",
    "borderTopLeftRadius": "var(--radius-xs)",
    "borderTopRightRadius": "var(--radius-xs)",
    "borderBottomRightRadius": "var(--radius-xs)",
    "borderBottomLeftRadius": "var(--radius-xs)",
    "color": "var(--warning)",
    "backgroundColor": "var(--warning-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "9.5px",
    "lineHeight": 1,
    "fontFamily": "var(--chat-mono)",
    "fontStyle": "normal",
    "fontWeight": 600,
    "fontStretch": "normal",
    "fontVariantCaps": "normal"
  },
  "changedFilesStatusIsAdded": {
    "color": "var(--success)",
    "backgroundColor": "var(--success-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "changedFilesStatusIsUntracked": {
    "color": "var(--success)",
    "backgroundColor": "var(--success-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "changedFilesStatusIsDeleted": {
    "color": "var(--danger)",
    "backgroundColor": "var(--danger-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "changedFilesStatusIsConflicted": {
    "color": "var(--danger)",
    "backgroundColor": "var(--danger-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "changedFilesPath": {
    "minWidth": 0,
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "0%",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "color": "var(--text-secondary)",
    "fontFamily": "var(--chat-mono)",
    "textOverflow": "ellipsis",
    "whiteSpace": "nowrap"
  },
  "resizeHandle": {
    "position": "relative",
    "zIndex": 12,
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "paddingTop": 0,
    "paddingRight": 0,
    "paddingBottom": 0,
    "paddingLeft": 0,
    "touchAction": "none",
    "outlineWidth": {
      "default": 0,
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
      "default": null,
      ":focus-visible": "-2px"
    }
  },
  "resizeHandleVertical": {
    "width": "7px",
    "marginInlineStart": "-3px",
    "marginInlineEnd": "-3px",
    "cursor": "col-resize"
  },
  "resizeHandleVerticalEnd": {
    "zIndex": 31,
    "alignSelf": "stretch",
    "WebkitAppRegion": "no-drag"
  },
  "resizeHandleHorizontal": {
    "width": "100%",
    "height": "7px",
    "marginBlockStart": "-3px",
    "marginBlockEnd": "-3px",
    "cursor": "row-resize"
  },
  "iconButton": {
    "position": "relative",
    "display": "inline-grid",
    "placeItems": "center",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "width": "28px",
    "height": "28px",
    "paddingTop": 0,
    "paddingRight": 0,
    "paddingBottom": 0,
    "paddingLeft": 0,
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "color": {
      "default": "var(--text-secondary)",
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
    "transition": "color var(--fast), background var(--fast), transform 100ms ease-out"
  },
  "button": {
    "minHeight": "30px",
    "display": "inline-flex",
    "alignItems": "center",
    "justifyContent": "center",
    "rowGap": "6px",
    "columnGap": "6px",
    "paddingTop": 0,
    "paddingRight": "11px",
    "paddingBottom": 0,
    "paddingLeft": "11px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "var(--border-strong)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "var(--border-strong)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border-strong)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "var(--border-strong)",
    "borderTopLeftRadius": "var(--radius-md)",
    "borderTopRightRadius": "var(--radius-md)",
    "borderBottomRightRadius": "var(--radius-md)",
    "borderBottomLeftRadius": "var(--radius-md)",
    "color": "var(--text)",
    "backgroundColor": {
      "default": "var(--surface-hover)",
      ":hover": "var(--surface-selected)"
    },
    "backgroundImage": {
      "default": "var(--gradient-apex)",
      ":hover": "var(--gradient-apex)"
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
    "boxShadow": {
      "default": "var(--shadow-control)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover:not(:disabled)": "var(--shadow-control-hover)"
      }
    },
    "fontSize": "var(--fs-body)",
    "fontWeight": 550,
    "transition": "background var(--fast), border-color var(--fast), box-shadow var(--fast), transform 100ms ease-out"
  },
  "buttonCompact": {
    "minHeight": "28px",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "paddingInlineStart": "9px",
    "paddingInlineEnd": "9px"
  },
  "buttonPrimary": {
    "borderTopLeftRadius": "var(--radius-md)",
    "borderTopRightRadius": "var(--radius-md)",
    "borderBottomRightRadius": "var(--radius-md)",
    "borderBottomLeftRadius": "var(--radius-md)",
    "paddingInlineStart": "11px",
    "paddingInlineEnd": "11px",
    "color": {
      "default": "var(--text)",
      ":hover": "var(--text)"
    },
    "backgroundColor": {
      "default": "var(--surface-selected)",
      ":hover": "color-mix(in srgb, var(--surface-selected) 82%, var(--text))"
    },
    "backgroundImage": {
      "default": "var(--gradient-apex)",
      ":hover": "var(--gradient-apex)"
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
    "boxShadow": {
      "default": "var(--shadow-control)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover:not(:disabled)": "var(--shadow-control-hover)"
      }
    },
    "borderTopColor": {
      "default": "var(--border-apex)",
      ":hover": "var(--apex)"
    },
    "borderRightColor": {
      "default": "var(--border-apex)",
      ":hover": "var(--apex)"
    },
    "borderBottomColor": {
      "default": "var(--border-apex)",
      ":hover": "var(--apex)"
    },
    "borderLeftColor": {
      "default": "var(--border-apex)",
      ":hover": "var(--apex)"
    }
  },
  "buttonDanger": {
    "color": "#fff",
    "backgroundColor": {
      "default": "var(--danger)",
      ":hover": "var(--danger)"
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
    "borderTopColor": "var(--danger)",
    "borderRightColor": "var(--danger)",
    "borderBottomColor": "var(--danger)",
    "borderLeftColor": "var(--danger)",
    "boxShadow": {
      "default": "none",
      ":hover": "none"
    },
    "filter": {
      "default": null,
      ":hover": "brightness(.94)"
    }
  },
  "piMark": {
    "display": "inline-grid",
    "placeItems": "center",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "rgba(125,211,252,.24)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "rgba(125,211,252,.24)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "rgba(125,211,252,.24)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "rgba(125,211,252,.24)",
    "borderTopLeftRadius": "26%",
    "borderTopRightRadius": "26%",
    "borderBottomRightRadius": "26%",
    "borderBottomLeftRadius": "26%",
    "color": "#f4f8fb",
    "backgroundColor": "transparent",
    "backgroundImage": "radial-gradient(circle at 50% 18%, #152538, #0b1119 74%)",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "0 2px 6px rgba(2,8,18,.28), inset 0 1px 0 rgba(125,211,252,.14)"
  },
  "piWelcomeMark": {
    "display": "inline-grid",
    "placeItems": "center",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
    "color": "#f4f8fb",
    "filter": "drop-shadow(0 10px 26px rgba(2,10,22,.34)) drop-shadow(0 0 18px rgba(56,189,248,.12))",
    "animationName": {
      "default": welcomeMarkInAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationDuration": {
      "default": "720ms",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationTimingFunction": {
      "default": "var(--ease-out)",
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    "animationIterationCount": {
      "default": "1",
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    "animationDirection": {
      "default": "normal",
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    "animationFillMode": {
      "default": "both",
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationPlayState": {
      "default": "running",
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  },
  "piWelcomeMarkWaveLeft": {
    "animationName": {
      "default": welcomeSwellAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationDuration": {
      "default": "7.2s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-in-out",
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    "animationDirection": {
      "default": "normal",
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    "animationFillMode": {
      "default": "none",
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationPlayState": {
      "default": "running",
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  },
  "piWelcomeMarkWaveRight": {
    "animationName": {
      "default": welcomeSwellAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationDuration": {
      "default": "7.2s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationDelay": {
      "default": "-3.6s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-in-out",
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    "animationDirection": {
      "default": "normal",
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    "animationFillMode": {
      "default": "none",
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationPlayState": {
      "default": "running",
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  },
  "piWelcomeMarkWaveFront": {
    "animationName": {
      "default": welcomeCrestAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationDuration": {
      "default": "5.6s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationDelay": {
      "default": "-1.2s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-in-out",
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    "animationDirection": {
      "default": "normal",
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    "animationFillMode": {
      "default": "none",
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationPlayState": {
      "default": "running",
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  },
  "piWelcomeMarkMoon": {
    "animationName": {
      "default": welcomeMoonAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationDuration": {
      "default": "8s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-in-out",
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    "animationDirection": {
      "default": "normal",
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    "animationFillMode": {
      "default": "none",
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationPlayState": {
      "default": "running",
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  },
  "piWelcomeMarkSpray": {
    "opacity": {
      "default": 0,
      "@media (prefers-reduced-motion: reduce)": 1,
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: 1
    },
    "animationName": {
      "default": welcomeSprayAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationDuration": {
      "default": "4.2s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-out",
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    "animationDirection": {
      "default": "normal",
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    "animationFillMode": {
      "default": "none",
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationPlayState": {
      "default": "running",
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  },
  "piWelcomeMarkSprayLate": {
    "animationDelay": {
      "default": "1.4s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    }
  },
  "piWelcomeMarkSprayLater": {
    "animationDelay": {
      "default": "2.8s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    }
  },
  "piWelcomeMarkRing": {
    "strokeDasharray": "3 6",
    "animationName": {
      "default": welcomeRingAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationDuration": {
      "default": "90s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "0s !important"
    },
    "animationTimingFunction": {
      "default": "linear",
      "@media (prefers-reduced-motion: reduce)": "ease !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "1 !important"
    },
    "animationDirection": {
      "default": "normal",
      "@media (prefers-reduced-motion: reduce)": "normal !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "normal !important"
    },
    "animationFillMode": {
      "default": "none",
      "@media (prefers-reduced-motion: reduce)": "none !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "none !important"
    },
    "animationPlayState": {
      "default": "running",
      "@media (prefers-reduced-motion: reduce)": "running !important",
      [stylex.when.ancestor("[class~=\"reduce-motion\"]", motionMarker)]: "running !important"
    }
  },
  "phIcon": {
    "flexShrink": 0
  }
});
