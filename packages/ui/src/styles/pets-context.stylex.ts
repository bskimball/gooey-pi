import * as stylex from '@stylexjs/stylex'
export const desktopPetMarker = stylex.defineMarker()
const dismissPulse = stylex.keyframes({
  "from": {
    "opacity": ".9",
    "transform": "scale(.78)"
  },
  "to": {
    "opacity": "0",
    "transform": "scale(1.3)"
  }
})
export const styles = stylex.create({
  "noTransition": {
    "transitionProperty": "none"
  },
  "drawerReduced": {
    "transitionProperty": "none",
    "::after": {
      "animationName": "none"
    }
  },
  "spriteImage": {
    "position": "absolute",
    "top": "0",
    "left": "0",
    "display": "block",
    "maxWidth": "none",
    "pointerEvents": "none",
    "imageRendering": "auto"
  },
  "orbStripe": {
    "position": "absolute",
    "zIndex": "1",
    "width": "54%",
    "height": "7%",
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
    "backgroundColor": "color-mix(in srgb, #fff 34%, transparent)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "filter": "blur(3px)",
    "transform": "rotate(-26deg)"
  },
  "orbStripeSecond": {
    "width": "68%",
    "transform": "translateY(140%) rotate(-26deg)",
    "opacity": ".65"
  },
  "orbStripeThird": {
    "width": "40%",
    "transform": "translateY(-150%) rotate(-26deg)",
    "opacity": ".45"
  },
  "orbReduced": {
    "animationName": "none",
    "::after": {
      "animationName": "none"
    }
  },
  "runningLeft": {
    "transform": "rotate(-3deg)"
  },
  "runningRight": {
    "transform": "rotate(3deg)"
  },
  "dismissArmed": {
    "opacity": ".7",
    "filter": "saturate(.58)",
    "transform": "scale(.9)",
    "transitionProperty": {
      "default": "opacity, filter, transform",
      "@media (prefers-reduced-motion: reduce)": "none"
    },
    "transitionDuration": "130ms, 130ms, 180ms",
    "transitionTimingFunction": "ease, ease, cubic-bezier(.2,.9,.2,1.15)",
    "transitionDelay": "0s"
  },
  "inactiveVoiceControls": {
    "marginTop": "-5px"
  },
  "voiceButton": {
    "width": "30px",
    "height": "30px",
    "display": "grid",
    "placeItems": "center",
    "paddingTop": "0",
    "paddingRight": "0",
    "paddingBottom": "0",
    "paddingLeft": "0",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": {
      "default": "var(--border-strong)",
      ":hover": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))",
      ":focus-visible": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))"
    },
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": {
      "default": "var(--border-strong)",
      ":hover": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))",
      ":focus-visible": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))"
    },
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": {
      "default": "var(--border-strong)",
      ":hover": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))",
      ":focus-visible": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))"
    },
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": {
      "default": "var(--border-strong)",
      ":hover": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))",
      ":focus-visible": "color-mix(in srgb, var(--apex) 52%, var(--border-strong))"
    },
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
    "color": {
      "default": "var(--text-secondary)",
      ":hover": "var(--text)",
      ":focus-visible": "var(--text)"
    },
    "backgroundColor": {
      "default": "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
      ":hover": "var(--surface-hover)",
      ":focus-visible": "var(--surface-hover)"
    },
    "backgroundImage": {
      "default": "none",
      ":hover": "none",
      ":focus-visible": "none"
    },
    "backgroundPosition": {
      "default": "0% 0%",
      ":hover": "0% 0%",
      ":focus-visible": "0% 0%"
    },
    "backgroundSize": {
      "default": "auto auto",
      ":hover": "auto auto",
      ":focus-visible": "auto auto"
    },
    "backgroundRepeat": {
      "default": "repeat",
      ":hover": "repeat",
      ":focus-visible": "repeat"
    },
    "backgroundAttachment": {
      "default": "scroll",
      ":hover": "scroll",
      ":focus-visible": "scroll"
    },
    "backgroundOrigin": {
      "default": "padding-box",
      ":hover": "padding-box",
      ":focus-visible": "padding-box"
    },
    "backgroundClip": {
      "default": "border-box",
      ":hover": "border-box",
      ":focus-visible": "border-box"
    },
    "boxShadow": "0 4px 12px color-mix(in srgb, #000 18%, transparent)",
    "backdropFilter": "blur(10px)",
    "pointerEvents": "auto"
  },
  "openVoiceButton": {
    "color": {
      "default": "var(--apex)",
      ":hover": "var(--apex)",
      ":focus-visible": "var(--apex)"
    }
  },
  "edgeRight": {
    "alignSelf": "flex-end",
    "marginRight": 0,
    "transform": "none"
  },
  "edgeLeft": {
    "alignSelf": "flex-start",
    "marginLeft": 0,
    "transform": "none"
  },
  "drawerVisible": {
    "opacity": "1",
    "transform": "translateY(0) scale(1)"
  },
  "drawerArmed": {
    "backgroundColor": "transparent",
    "backgroundImage": "linear-gradient(145deg, #ff5c55, var(--danger))",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "0 8px 28px color-mix(in srgb, var(--danger) 72%, transparent), 0 0 0 7px color-mix(in srgb, var(--danger) 14%, transparent), inset 0 1px 1px rgba(255,255,255,.28)",
    "transform": "scale(1.12)"
  },
  "drawerPulse": {
    "::after": {
      "animationName": {
        "default": dismissPulse,
        "@media (prefers-reduced-motion: reduce)": "none !important"
      },
      "animationDuration": {
        "default": "720ms",
        "@media (prefers-reduced-motion: reduce)": "0s !important"
      },
      "animationDelay": {
        "default": "0s",
        "@media (prefers-reduced-motion: reduce)": "0s !important"
      },
      "animationTimingFunction": {
        "default": "ease-out",
        "@media (prefers-reduced-motion: reduce)": "ease !important"
      },
      "animationIterationCount": {
        "default": "infinite",
        "@media (prefers-reduced-motion: reduce)": "1 !important"
      },
      "animationDirection": {
        "default": "normal",
        "@media (prefers-reduced-motion: reduce)": "normal !important"
      },
      "animationFillMode": {
        "default": "none",
        "@media (prefers-reduced-motion: reduce)": "none !important"
      },
      "animationPlayState": {
        "default": "running",
        "@media (prefers-reduced-motion: reduce)": "running !important"
      }
    }
  },
  "heroHeading": {
    "marginTop": "6px",
    "marginRight": "0",
    "marginBottom": "4px",
    "marginLeft": "0",
    "fontSize": "20px",
    "fontWeight": "600",
    "letterSpacing": "-.02em"
  },
  "heroDescription": {
    "marginTop": "0",
    "marginRight": "0",
    "marginBottom": "0",
    "marginLeft": "0",
    "color": "var(--text-secondary)",
    "fontSize": "var(--fs-meta)",
    "lineHeight": "1.5"
  },
  "choiceImage": {
    "width": "54px",
    "height": "54px",
    "objectFit": "contain"
  },
  "choiceCopy": {
    "minWidth": "0",
    "display": "flex",
    "flexDirection": "column"
  },
  "choiceName": {
    "overflowX": "hidden",
    "overflowY": "hidden",
    "fontSize": "var(--fs-ui)",
    "textOverflow": "ellipsis",
    "whiteSpace": "nowrap"
  },
  "choiceSource": {
    "marginTop": "2px",
    "color": "var(--text-tertiary)",
    "fontSize": "var(--fs-micro)"
  },
  "sizeInput": {
    "width": "100%",
    "minWidth": "0",
    "height": "18px",
    "paddingTop": "0",
    "paddingRight": "0",
    "paddingBottom": "0",
    "paddingLeft": "0",
    "borderTopWidth": "0",
    "borderTopStyle": "none",
    "borderTopColor": "currentColor",
    "borderRightWidth": "0",
    "borderRightStyle": "none",
    "borderRightColor": "currentColor",
    "borderBottomWidth": "0",
    "borderBottomStyle": "none",
    "borderBottomColor": "currentColor",
    "borderLeftWidth": "0",
    "borderLeftStyle": "none",
    "borderLeftColor": "currentColor",
    "borderTopLeftRadius": "999px",
    "borderTopRightRadius": "999px",
    "borderBottomRightRadius": "999px",
    "borderBottomLeftRadius": "999px",
    "outlineWidth": "0",
    "outlineStyle": "none",
    "outlineColor": "currentColor",
    "backgroundColor": "transparent",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "accentColor": "var(--apex)",
    "cursor": "ew-resize"
  },
  "sizeTrack": {
    "::-webkit-slider-runnable-track": {
      "height": "4px",
      "borderTopLeftRadius": "999px",
      "borderTopRightRadius": "999px",
      "borderBottomRightRadius": "999px",
      "borderBottomLeftRadius": "999px",
      "backgroundColor": "transparent",
      "backgroundImage": "linear-gradient(90deg, color-mix(in srgb, var(--apex) 78%, #fff) 0 var(--pet-size-progress, 33%), var(--surface-selected) var(--pet-size-progress, 33%) 100%)",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "boxShadow": "inset 0 0 0 1px color-mix(in srgb, var(--border-strong) 55%, transparent)"
    }
  },
  "sizeThumb": {
    "::-webkit-slider-thumb": {
      "width": "16px",
      "height": "16px",
      "marginTop": "-6px",
      "borderTopWidth": "2px",
      "borderTopStyle": "solid",
      "borderTopColor": "var(--surface-raised)",
      "borderRightWidth": "2px",
      "borderRightStyle": "solid",
      "borderRightColor": "var(--surface-raised)",
      "borderBottomWidth": "2px",
      "borderBottomStyle": "solid",
      "borderBottomColor": "var(--surface-raised)",
      "borderLeftWidth": "2px",
      "borderLeftStyle": "solid",
      "borderLeftColor": "var(--surface-raised)",
      "borderTopLeftRadius": "50%",
      "borderTopRightRadius": "50%",
      "borderBottomRightRadius": "50%",
      "borderBottomLeftRadius": "50%",
      "backgroundColor": "var(--apex)",
      "backgroundImage": "none",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "boxShadow": "0 1px 4px color-mix(in srgb, #000 32%, transparent), 0 0 0 1px color-mix(in srgb, var(--apex) 72%, transparent)",
      "WebkitAppearance": "none"
    },
    ":focus-visible": {
      "::-webkit-slider-thumb": {
        "boxShadow": "0 0 0 3px color-mix(in srgb, var(--focus) 30%, transparent)"
      }
    }
  },
  "sizeOutput": {
    "color": "var(--text-secondary)",
    "fontSize": "10px",
    "lineHeight": "1",
    "fontFamily": "\"SFMono-Regular\", Menlo, monospace",
    "fontStyle": "normal",
    "fontWeight": "600",
    "fontStretch": "normal",
    "fontVariantCaps": "normal",
    "textAlign": "right",
    "fontVariantNumeric": "tabular-nums"
  },
  "receipt": {
    "width": "min(210px, calc(100vw - 16px))",
    "marginTop": "4px",
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": 0,
    "pointerEvents": "auto",
    "alignSelf": {
      "default": "auto",
      [stylex.when.ancestor('[data-horizontal-edge="right"]', desktopPetMarker)]: "flex-end",
      [stylex.when.ancestor('[data-horizontal-edge="left"]', desktopPetMarker)]: "flex-start"
    },
    "transform": {
      "default": "none",
      [stylex.when.ancestor('[data-horizontal-edge="right"]', desktopPetMarker)]: "none",
      [stylex.when.ancestor('[data-horizontal-edge="left"]', desktopPetMarker)]: "none"
    }
  }
})
