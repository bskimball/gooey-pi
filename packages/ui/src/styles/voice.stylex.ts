import * as stylex from '@stylexjs/stylex';
export const voiceOrbMarker = stylex.defineMarker();
const orbHaloAnimation = stylex.keyframes({
  "50%": {
    "transform": "scale(1.12) rotate(18deg)",
    "borderTopLeftRadius": "58% 42%",
    "borderTopRightRadius": "42% 55%",
    "borderBottomRightRadius": "45% 45%",
    "borderBottomLeftRadius": "55% 58%"
  }
});
const orbBreatheAnimation = stylex.keyframes({
  "0%": {
    "transform": "scale(.96) rotate(-2deg)"
  },
  "100%": {
    "transform": "scale(.96) rotate(-2deg)"
  },
  "50%": {
    "transform": "scale(1.03) rotate(2deg)",
    "borderTopLeftRadius": "54% 46%",
    "borderTopRightRadius": "46% 57%",
    "borderBottomRightRadius": "45% 43%",
    "borderBottomLeftRadius": "55% 54%"
  }
});
const orbRotateAnimation = stylex.keyframes({
  "to": {
    "transform": "rotate(360deg)"
  }
});
export const styles = stylex.create({
  "voiceToggleActive": {
    "color": "var(--apex) !important",
    "backgroundColor": "color-mix(in srgb, var(--apex) 12%, var(--surface-selected)) !important",
    "backgroundImage": "none !important",
    "backgroundPosition": "0% 0% !important",
    "backgroundSize": "auto auto !important",
    "backgroundRepeat": "repeat !important",
    "backgroundAttachment": "scroll !important",
    "backgroundOrigin": "padding-box !important",
    "backgroundClip": "border-box !important"
  },
  "voiceSessionAudio": {
    "display": "none"
  },
  "voiceOrb": {
    "--orb-x": "80vw",
    "--orb-y": "90px",
    "position": "fixed",
    "zIndex": 120,
    "left": "var(--orb-x)",
    "top": "var(--orb-y)",
    "width": "136px",
    "color": "var(--text)",
    "filter": "drop-shadow(0 18px 24px color-mix(in srgb, #000 25%, transparent))"
  },
  "voiceOrbDrag": {
    "width": "136px",
    "height": "150px",
    "position": "relative",
    "display": "grid",
    "placeItems": "center",
    "paddingBottom": "20px",
    "touchAction": "none",
    "userSelect": "none",
    "cursor": {
      "default": "grab",
      ":active": "grabbing"
    }
  },
  "voiceOrbHalo": {
    "position": "absolute",
    "top": "13px",
    "width": "112px",
    "height": "112px",
    "borderTopLeftRadius": "46% 52%",
    "borderTopRightRadius": "54% 43%",
    "borderBottomRightRadius": "52% 57%",
    "borderBottomLeftRadius": "48% 48%",
    "backgroundColor": "transparent",
    "backgroundImage": "radial-gradient(circle at 34% 28%, color-mix(in srgb, #fff 50%, transparent), transparent 32%), conic-gradient(from 160deg, #3b7fb5, #7eb0dc, #a9c8e4, #2d6595, #3b7fb5)",
    "backgroundPosition": "0% 0%, 0% 0%",
    "backgroundSize": "auto auto, auto auto",
    "backgroundRepeat": "repeat, repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "opacity": 0.22,
    "filter": "blur(15px)",
    "animationName": {
      "default": orbHaloAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important"
    },
    "animationDuration": {
      "default": "3.8s",
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
  "voiceOrbCore": {
    "position": "relative",
    "width": "94px",
    "height": "94px",
    "display": "grid",
    "placeItems": "center",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, #a9c8e4 36%, transparent)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, #a9c8e4 36%, transparent)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, #a9c8e4 36%, transparent)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, #a9c8e4 36%, transparent)",
    "borderTopLeftRadius": "45% 56%",
    "borderTopRightRadius": "55% 44%",
    "borderBottomRightRadius": "53% 56%",
    "borderBottomLeftRadius": "47% 44%",
    "backgroundColor": "transparent",
    "backgroundImage": "radial-gradient(circle at 35% 27%, #e8eff6 0 5%, transparent 28%), radial-gradient(circle at 64% 70%, #7eb0dc, transparent 45%), linear-gradient(145deg, #4a86ba, #2d6595 58%, #0b1119)",
    "backgroundPosition": "0% 0%, 0% 0%, 0% 0%",
    "backgroundSize": "auto auto, auto auto, auto auto",
    "backgroundRepeat": "repeat, repeat, repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "inset 0 0 22px color-mix(in srgb, #a9c8e4 22%, transparent), 0 9px 24px color-mix(in srgb, #3b7fb5 26%, transparent)",
    "animationName": {
      "default": orbBreatheAnimation,
      "@media (prefers-reduced-motion: reduce)": "none !important"
    },
    "animationDuration": {
      "default": "3.2s",
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
    },
    "::after": {
      "content": "''",
      "position": "absolute",
      "top": "-22%",
      "right": "-22%",
      "bottom": "-22%",
      "left": "-22%",
      "borderTopLeftRadius": "45%",
      "borderTopRightRadius": "45%",
      "borderBottomRightRadius": "45%",
      "borderBottomLeftRadius": "45%",
      "backgroundColor": "transparent",
      "backgroundImage": "conic-gradient(from 20deg, transparent, color-mix(in srgb, #fff 32%, transparent), transparent 36%)",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "animationName": {
        "default": orbRotateAnimation,
        "@media (prefers-reduced-motion: reduce)": "none !important"
      },
      "animationDuration": {
        "default": "6s",
        "@media (prefers-reduced-motion: reduce)": "0s !important"
      },
      "animationDelay": {
        "default": "0s",
        "@media (prefers-reduced-motion: reduce)": "0s !important"
      },
      "animationTimingFunction": {
        "default": "linear",
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
  "voiceOrbStatus": {
    "position": "absolute",
    "bottom": "13px",
    "paddingTop": "3px",
    "paddingRight": "8px",
    "paddingBottom": "3px",
    "paddingLeft": "8px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--border) 70%, transparent)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--border) 70%, transparent)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--border) 70%, transparent)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--border) 70%, transparent)",
    "borderTopLeftRadius": "999px",
    "borderTopRightRadius": "999px",
    "borderBottomRightRadius": "999px",
    "borderBottomLeftRadius": "999px",
    "color": "var(--text-secondary)",
    "backgroundColor": "color-mix(in srgb, var(--surface-raised) 88%, transparent)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "backdropFilter": "blur(10px)",
    "fontSize": "var(--fs-micro)",
    "fontWeight": 600,
    "letterSpacing": ".01em"
  },
  "voiceOrbControls": {
    "position": "absolute",
    "zIndex": 2,
    "bottom": "-14px",
    "display": "flex",
    "rowGap": "9px",
    "columnGap": "9px",
    "opacity": {
      "default": 0,
      [stylex.when.ancestor(":hover", voiceOrbMarker)]: 1,
      [stylex.when.ancestor(":focus-within", voiceOrbMarker)]: 1
    },
    "transform": {
      "default": "translateY(-5px)",
      [stylex.when.ancestor(":hover", voiceOrbMarker)]: "translateY(0)",
      [stylex.when.ancestor(":focus-within", voiceOrbMarker)]: "translateY(0)"
    },
    "transition": {
      "default": "opacity 150ms ease, transform 150ms ease",
      "@media (prefers-reduced-motion: reduce)": "none !important"
    }
  },
  "voiceOrbReceipt": {
    "width": "210px",
    "marginTop": "3px",
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": "50%",
    "paddingTop": "8px",
    "paddingRight": "10px",
    "paddingBottom": "8px",
    "paddingLeft": "10px",
    "display": "grid",
    "rowGap": "2px",
    "columnGap": "2px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--success) 38%, var(--border))",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--success) 38%, var(--border))",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--success) 38%, var(--border))",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--success) 38%, var(--border))",
    "borderTopLeftRadius": "var(--radius-md)",
    "borderTopRightRadius": "var(--radius-md)",
    "borderBottomRightRadius": "var(--radius-md)",
    "borderBottomLeftRadius": "var(--radius-md)",
    "color": "var(--text)",
    "backgroundColor": "color-mix(in srgb, var(--surface-raised) 94%, transparent)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "0 8px 24px color-mix(in srgb, #000 14%, transparent)",
    "transform": "translateX(-50%)"
  }
});
