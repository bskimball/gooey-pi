import * as stylex from '@stylexjs/stylex';
const orbUserAnimation = stylex.keyframes({
  "from": {
    "transform": "scale(.94,.99) rotate(-4deg)",
    "borderTopLeftRadius": "40% 58%",
    "borderTopRightRadius": "60% 41%",
    "borderBottomRightRadius": "52% 59%",
    "borderBottomLeftRadius": "48% 42%"
  },
  "to": {
    "transform": "scale(1.08,.96) rotate(4deg)",
    "borderTopLeftRadius": "59% 42%",
    "borderTopRightRadius": "41% 58%",
    "borderBottomRightRadius": "44% 43%",
    "borderBottomLeftRadius": "56% 57%"
  }
});
const orbThinkingAnimation = stylex.keyframes({
  "0%": {
    "transform": "rotate(-5deg) scale(.97)"
  },
  "100%": {
    "transform": "rotate(-5deg) scale(.97)"
  },
  "50%": {
    "transform": "rotate(8deg) scale(1.03)",
    "borderTopLeftRadius": "58% 43%",
    "borderTopRightRadius": "42% 62%",
    "borderBottomRightRadius": "61% 38%",
    "borderBottomLeftRadius": "39% 57%"
  }
});
const orbAgentAnimation = stylex.keyframes({
  "from": {
    "transform": "scale(.9,1.08) rotate(-8deg)",
    "borderTopLeftRadius": "36% 61%",
    "borderTopRightRadius": "64% 37%",
    "borderBottomRightRadius": "43% 63%",
    "borderBottomLeftRadius": "57% 39%"
  },
  "to": {
    "transform": "scale(1.13,.92) rotate(7deg)",
    "borderTopLeftRadius": "65% 39%",
    "borderTopRightRadius": "35% 64%",
    "borderBottomRightRadius": "59% 36%",
    "borderBottomLeftRadius": "41% 61%"
  }
});
const orbAgentHaloAnimation = stylex.keyframes({
  "to": {
    "transform": "scale(1.28) rotate(24deg)",
    "filter": "blur(20px)"
  }
});
export const styles = stylex.create({
  "wave": {
    "position": "absolute",
    "width": "48px",
    "height": "7px",
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
    "backgroundColor": "color-mix(in srgb, #fff 32%, transparent)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "filter": "blur(4px)",
    "transform": "rotate(-26deg) translateY(var(--wave-y, 0))"
  },
  "waveSecond": {
    "--wave-y": "16px",
    "width": "64px",
    "opacity": 0.65
  },
  "waveThird": {
    "--wave-y": "-17px",
    "width": "38px",
    "opacity": 0.45
  },
  "controlButton": {
    "width": "31px",
    "height": "31px",
    "display": "grid",
    "placeItems": "center",
    "paddingTop": 0,
    "paddingRight": 0,
    "paddingBottom": 0,
    "paddingLeft": 0,
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
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
    "color": {
      "default": "var(--text-secondary)",
      ":hover": "var(--text)"
    },
    "backgroundColor": {
      "default": "var(--surface-raised)",
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
    "boxShadow": "0 4px 12px color-mix(in srgb, #000 16%, transparent)"
  },
  "error": {
    "width": "210px",
    "marginTop": "3px",
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": "50%",
    "paddingTop": "6px",
    "paddingRight": "8px",
    "paddingBottom": "6px",
    "paddingLeft": "8px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--danger) 35%, var(--border))",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--danger) 35%, var(--border))",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--danger) 35%, var(--border))",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--danger) 35%, var(--border))",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "color": "var(--danger)",
    "backgroundColor": "var(--surface-raised)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "var(--fs-micro)",
    "lineHeight": 1.35,
    "transform": "translateX(-50%)"
  },
  "receiptTitle": {
    "color": "var(--success)",
    "fontSize": "var(--fs-meta)",
    "fontWeight": 600
  },
  "receiptDetail": {
    "overflowX": "hidden",
    "overflowY": "hidden",
    "fontSize": "var(--fs-micro)",
    "textOverflow": "ellipsis",
    "whiteSpace": "nowrap"
  },
  "receiptStatus": {
    "color": "var(--text-secondary)",
    "fontSize": "var(--fs-micro)"
  },
  "userCore": {
    "animationName": {
      "default": orbUserAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important"
    },
    "animationDuration": {
      "default": "520ms",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-in-out",
      "@media (prefers-reduced-motion: reduce)": "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important"
    },
    "animationDirection": {
      "default": "alternate",
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
  },
  "userHalo": {
    "opacity": 0.58,
    "animationDuration": {
      "default": "760ms",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    }
  },
  "thinkingCore": {
    "animationName": {
      "default": orbThinkingAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important"
    },
    "animationDuration": {
      "default": "1.7s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-in-out",
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
  },
  "agentCore": {
    "animationName": {
      "default": orbAgentAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important"
    },
    "animationDuration": {
      "default": "620ms",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationTimingFunction": {
      "default": "cubic-bezier(.3,.8,.2,1)",
      "@media (prefers-reduced-motion: reduce)": "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important"
    },
    "animationDirection": {
      "default": "alternate",
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
  },
  "agentHalo": {
    "opacity": 0.72,
    "animationName": {
      "default": orbAgentHaloAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important"
    },
    "animationDuration": {
      "default": "700ms",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease-in-out",
      "@media (prefers-reduced-motion: reduce)": "ease !important"
    },
    "animationIterationCount": {
      "default": "infinite",
      "@media (prefers-reduced-motion: reduce)": "1 !important"
    },
    "animationDirection": {
      "default": "alternate",
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
  },
  "errorCore": {
    "filter": "grayscale(.45)",
    "opacity": 0.8,
    "animationName": {
      "default": "none",
      "@media (prefers-reduced-motion: reduce)": "none !important"
    },
    "animationDuration": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationDelay": {
      "default": "0s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    },
    "animationTimingFunction": {
      "default": "ease",
      "@media (prefers-reduced-motion: reduce)": "ease !important"
    },
    "animationIterationCount": {
      "default": 1,
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
  },
  "mutedCore": {
    "filter": "saturate(.45)",
    "animationDuration": {
      "default": "5s",
      "@media (prefers-reduced-motion: reduce)": "0s !important"
    }
  }
});
