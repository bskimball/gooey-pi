import * as stylex from '@stylexjs/stylex';
export const terminalTabMarker = stylex.defineMarker();
const drawerInAnimation = stylex.keyframes({
  "from": {
    "opacity": 0.7,
    "transform": "translateY(8px)"
  }
});
export const styles = stylex.create({
  "terminalHeaderButton": { "width": "32px", "height": "32px" },
  "terminalDrawer": {
    "height": "var(--terminal-height, clamp(260px, 34vh, 390px))",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "var(--terminal-height, clamp(260px, 34vh, 390px))",
    "display": "flex",
    "flexDirection": "column",
    "minHeight": 0,
    "backgroundColor": "var(--terminal-bg)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "animationName": drawerInAnimation,
    "animationDuration": "180ms",
    "animationDelay": "0s",
    "animationTimingFunction": "ease-out",
    "animationIterationCount": 1,
    "animationDirection": "normal",
    "animationFillMode": "none",
    "animationPlayState": "running"
  },
  "terminalDrawerLoading": {
    "alignItems": "center",
    "justifyContent": "center",
    "color": "var(--terminal-control)",
    "fontSize": "var(--fs-meta)",
    "animationName": "none",
    "animationDuration": "0s",
    "animationDelay": "0s",
    "animationTimingFunction": "ease",
    "animationIterationCount": 1,
    "animationDirection": "normal",
    "animationFillMode": "none",
    "animationPlayState": "running"
  },
  "terminalDrawerIsMaximized": {
    "position": "absolute",
    "zIndex": 60,
    "top": 0,
    "right": 0,
    "bottom": 0,
    "left": 0,
    "height": "auto",
    "flexBasis": "auto"
  },
  "terminalToolbar": {
    "height": "37px",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "37px",
    "display": "flex",
    "alignItems": "center",
    "justifyContent": "space-between",
    "paddingTop": 0,
    "paddingRight": "8px",
    "paddingBottom": 0,
    "paddingLeft": "8px",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--terminal-border)",
    "color": "var(--terminal-control)",
    "backgroundColor": "var(--terminal-toolbar-bg)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "terminalTabs": {
    "height": "100%",
    "display": "flex",
    "alignItems": "center",
    "rowGap": "2px",
    "columnGap": "2px",
    "minWidth": 0,
    "overflowX": "auto",
    "scrollbarWidth": "none",
    "::-webkit-scrollbar": {
      "display": "none"
    }
  },
  "terminalActions": {
    "height": "100%",
    "display": "flex",
    "alignItems": "center",
    "rowGap": "2px",
    "columnGap": "2px"
  },
  "terminalTab": {
    "height": "29px",
    "display": "flex",
    "alignItems": "center",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "color": "var(--terminal-control)",
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "terminalTabIsActive": {
    "color": "var(--terminal-control-active)",
    "backgroundColor": "var(--terminal-control-bg)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "terminalTabClose": {
    "position": "relative",
    "width": "20px",
    "height": "20px",
    "display": "grid",
    "placeItems": "center",
    "marginRight": "3px",
    "borderTopLeftRadius": "var(--radius-xs)",
    "borderTopRightRadius": "var(--radius-xs)",
    "borderBottomRightRadius": "var(--radius-xs)",
    "borderBottomLeftRadius": "var(--radius-xs)",
    "color": "inherit",
    "backgroundColor": {
      "default": "transparent",
      ":hover": "var(--terminal-control-hover)"
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
    "opacity": {
      "default": 0,
      ":hover": 1,
      [stylex.when.ancestor(":hover", terminalTabMarker)]: {
        "default": 0.7,
        ":hover": 0.7
      },
      [stylex.when.ancestor(":focus-within", terminalTabMarker)]: {
        "default": 0.7,
        ":hover": 0.7
      }
    },
    "::before": {
      "position": "absolute",
      "top": "-4px",
      "right": "-3px",
      "bottom": "-4px",
      "left": "-3px",
      "content": "\"\""
    }
  },
  "terminalLiveDot": {
    "width": "5px",
    "height": "5px",
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
    "backgroundColor": "var(--terminal-control)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "terminalLiveDotIsConnected": {
    "backgroundColor": "var(--success)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "terminalCwd": {
    "maxWidth": "150px",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "whiteSpace": "nowrap",
    "textOverflow": "ellipsis",
    "paddingTop": 0,
    "paddingRight": "6px",
    "paddingBottom": 0,
    "paddingLeft": "6px",
    "fontSize": "var(--fs-micro)"
  },
  "terminalViews": {
    "position": "relative",
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "0%",
    "minHeight": 0
  },
  "terminalSurface": {
    "position": "absolute",
    "top": 0,
    "right": 0,
    "bottom": 0,
    "left": 0,
    "paddingTop": "8px",
    "paddingRight": "7px",
    "paddingBottom": "4px",
    "paddingLeft": "7px",
    "overflowX": "hidden",
    "overflowY": "hidden"
  }
});
export const contextStyles = stylex.create({
  hidden: {
    display: 'none'
  },
  tabButton: {
    height: 29,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    paddingTop: 0,
    paddingRight: 5,
    paddingBottom: 0,
    paddingLeft: 8,
    color: 'inherit',
    backgroundColor: 'transparent',
    fontSize: 'var(--fs-meta)'
  },
  closeActive: {
    opacity: {
      default: .7,
      ':hover': .7
    }
  },
  xterm: {
    height: '100%',
    backgroundColor: 'var(--terminal-bg)'
  },
  viewport: {
    backgroundColor: 'var(--terminal-bg)',
    scrollbarWidth: 'thin'
  }
});
