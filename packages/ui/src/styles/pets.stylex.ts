import * as stylex from '@stylexjs/stylex'

const petPlaceholderAnimation = stylex.keyframes({ "50%": { "transform": "scale(.92, 1.05)", "borderTopLeftRadius": "56%", "borderTopRightRadius": "44%", "borderBottomRightRadius": "42%", "borderBottomLeftRadius": "58%" } })

const petOrbIdleAnimation = stylex.keyframes({
  "50%": {
    "transform": "scale(1.05,.96) rotate(3deg)",
    "borderTopLeftRadius": "56% 44%",
    "borderTopRightRadius": "44% 58%",
    "borderBottomRightRadius": "45% 42%",
    "borderBottomLeftRadius": "55% 56%",
  },
})

const petOrbRotateAnimation = stylex.keyframes({ "to": { "transform": "rotate(360deg)" } })

const petOrbSpeakingAnimation = stylex.keyframes({ "from": { "transform": "scale(.9,1.08) rotate(-7deg)" }, "to": { "transform": "scale(1.12,.91) rotate(7deg)" } })

const petOrbWorkingAnimation = stylex.keyframes({ "0%": { "transform": "rotate(-5deg) scale(.97)" }, "100%": { "transform": "rotate(-5deg) scale(.97)" }, "50%": { "transform": "rotate(8deg) scale(1.04)" } })

const petOrbRunningAnimation = stylex.keyframes({ "from": { "transform": "translateY(0) scale(1.08,.9)" }, "to": { "transform": "translateY(-8px) scale(.94,1.08)" } })

const petOrbJumpAnimation = stylex.keyframes({ "50%": { "transform": "translateY(-18px) scale(.96,1.06)" } })

export const styles = stylex.create({
  "petSprite": { "position": "relative", "display": "inline-block", "flexGrow": 0, "flexShrink": 0, "flexBasis": "auto", "overflowX": "hidden", "overflowY": "hidden" },
  "petPlaceholder": {
    "display": "inline-block",
    "borderTopLeftRadius": "48%",
    "borderTopRightRadius": "52%",
    "borderBottomRightRadius": "55%",
    "borderBottomLeftRadius": "45%",
    "backgroundColor": "color-mix(in srgb, var(--apex) 18%, var(--surface-selected))",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "animationName": { "default": petPlaceholderAnimation, "@media (prefers-reduced-motion: reduce)": "none !important" },
    "animationDuration": { "default": "1.5s", "@media (prefers-reduced-motion: reduce)": "0s !important" },
    "animationDelay": { "default": "0s", "@media (prefers-reduced-motion: reduce)": "0s !important" },
    "animationTimingFunction": { "default": "ease-in-out", "@media (prefers-reduced-motion: reduce)": "ease !important" },
    "animationIterationCount": { "default": "infinite", "@media (prefers-reduced-motion: reduce)": "1 !important" },
    "animationDirection": { "default": "normal", "@media (prefers-reduced-motion: reduce)": "normal !important" },
    "animationFillMode": { "default": "none", "@media (prefers-reduced-motion: reduce)": "none !important" },
    "animationPlayState": { "default": "running", "@media (prefers-reduced-motion: reduce)": "running !important" },
  },
  "petOrb": {
    "position": "relative",
    "display": "inline-grid",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
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
    "boxShadow": "inset 0 0 18px color-mix(in srgb, #a9c8e4 22%, transparent), 0 8px 20px color-mix(in srgb, #3b7fb5 24%, transparent)",
    "animationName": { "default": petOrbIdleAnimation, "@media (prefers-reduced-motion: reduce)": "none !important" },
    "animationDuration": { "default": "3s", "@media (prefers-reduced-motion: reduce)": "0s !important" },
    "animationDelay": { "default": "0s", "@media (prefers-reduced-motion: reduce)": "0s !important" },
    "animationTimingFunction": { "default": "ease-in-out", "@media (prefers-reduced-motion: reduce)": "ease !important" },
    "animationIterationCount": { "default": "infinite", "@media (prefers-reduced-motion: reduce)": "1 !important" },
    "animationDirection": { "default": "normal", "@media (prefers-reduced-motion: reduce)": "normal !important" },
    "animationFillMode": { "default": "none", "@media (prefers-reduced-motion: reduce)": "none !important" },
    "animationPlayState": { "default": "running", "@media (prefers-reduced-motion: reduce)": "running !important" },
    "::after": {
      "content": "''",
      "position": "absolute",
      "top": "-24%",
      "right": "-24%",
      "bottom": "-24%",
      "left": "-24%",
      "borderTopLeftRadius": "45%",
      "borderTopRightRadius": "45%",
      "borderBottomRightRadius": "45%",
      "borderBottomLeftRadius": "45%",
      "backgroundColor": "transparent",
      "backgroundImage": "conic-gradient(from 20deg, transparent, color-mix(in srgb, #fff 34%, transparent), transparent 36%)",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "animationName": { "default": petOrbRotateAnimation, "@media (prefers-reduced-motion: reduce)": "none !important" },
      "animationDuration": { "default": "5.5s", "@media (prefers-reduced-motion: reduce)": "0s !important" },
      "animationDelay": { "default": "0s", "@media (prefers-reduced-motion: reduce)": "0s !important" },
      "animationTimingFunction": { "default": "linear", "@media (prefers-reduced-motion: reduce)": "ease !important" },
      "animationIterationCount": { "default": "infinite", "@media (prefers-reduced-motion: reduce)": "1 !important" },
      "animationDirection": { "default": "normal", "@media (prefers-reduced-motion: reduce)": "normal !important" },
      "animationFillMode": { "default": "none", "@media (prefers-reduced-motion: reduce)": "none !important" },
      "animationPlayState": { "default": "running", "@media (prefers-reduced-motion: reduce)": "running !important" },
    },
  },
  "petOrbSpeaking": {
  "animationName": {
    "default": petOrbSpeakingAnimation,
    "@media (prefers-reduced-motion: reduce)": "none !important"
  },
  "animationDuration": {
    "default": "560ms",
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
  "petOrbWorking": {
  "animationName": {
    "default": petOrbWorkingAnimation,
    "@media (prefers-reduced-motion: reduce)": "none !important"
  },
  "animationDuration": {
    "default": "1.5s",
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
  "petOrbRunningLeft": {
  "animationName": {
    "default": petOrbRunningAnimation,
    "@media (prefers-reduced-motion: reduce)": "none !important"
  },
  "animationDuration": {
    "default": "260ms",
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
  "petOrbRunningRight": {
  "animationName": {
    "default": petOrbRunningAnimation,
    "@media (prefers-reduced-motion: reduce)": "none !important"
  },
  "animationDuration": {
    "default": "260ms",
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
  "petOrbJumping": {
  "animationName": {
    "default": petOrbJumpAnimation,
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
},
  "petOrbFailed": {
  "filter": "grayscale(.55)",
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
  "desktopPet": {
    "position": "fixed",
    "zIndex": 120,
    "width": "var(--pet-surface-width, 96px)",
    "minHeight": "var(--pet-surface-min-height, 122px)",
    "display": "flex",
    "alignItems": "center",
    "flexDirection": "column",
    "color": "var(--text)",
    "pointerEvents": "none",
    "userSelect": "none",
    "filter": "drop-shadow(0 12px 14px color-mix(in srgb, #000 20%, transparent))",
  },
  "desktopPetDragTarget": {
    "width": "var(--pet-avatar-size, 72px)",
    "minHeight": "var(--pet-avatar-size, 72px)",
    "display": "flex",
    "alignItems": "center",
    "flexDirection": "column",
    "justifyContent": "flex-end",
    "paddingTop": 0,
    "paddingRight": 0,
    "paddingBottom": 0,
    "paddingLeft": 0,
    "borderTopLeftRadius": "18px",
    "borderTopRightRadius": "18px",
    "borderBottomRightRadius": "18px",
    "borderBottomLeftRadius": "18px",
    "outlineWidth": { "default": 0, ":focus-visible": "2px" },
    "outlineStyle": { "default": "none", ":focus-visible": "solid" },
    "outlineColor": { "default": "currentColor", ":focus-visible": "var(--focus)" },
    "pointerEvents": "auto",
    "touchAction": "none",
    "cursor": { "default": "grab", ":active": "grabbing" },
    "outlineOffset": { "default": null, ":focus-visible": "3px" },
    "backgroundColor": { "default": null, ":focus-visible": "color-mix(in srgb, var(--surface-raised) 52%, transparent)" },
    "backgroundImage": { "default": null, ":focus-visible": "none" },
    "backgroundPosition": { "default": null, ":focus-visible": "0% 0%" },
    "backgroundSize": { "default": null, ":focus-visible": "auto auto" },
    "backgroundRepeat": { "default": null, ":focus-visible": "repeat" },
    "backgroundAttachment": { "default": null, ":focus-visible": "scroll" },
    "backgroundOrigin": { "default": null, ":focus-visible": "padding-box" },
    "backgroundClip": { "default": null, ":focus-visible": "border-box" },
  },
  "desktopPetAvatar": { "position": "relative", "display": "inline-flex" },
  "desktopPetVoiceStatus": {
    "maxWidth": "112px",
    "marginTop": "-5px",
    "paddingTop": "3px",
    "paddingRight": "8px",
    "paddingBottom": "3px",
    "paddingLeft": "8px",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--apex) 34%, var(--border))",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--apex) 34%, var(--border))",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--apex) 34%, var(--border))",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--apex) 34%, var(--border))",
    "borderTopLeftRadius": "999px",
    "borderTopRightRadius": "999px",
    "borderBottomRightRadius": "999px",
    "borderBottomLeftRadius": "999px",
    "color": "var(--text-secondary)",
    "backgroundColor": "color-mix(in srgb, var(--surface-raised) 91%, transparent)",
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
    "lineHeight": 1.2,
    "textOverflow": "ellipsis",
    "whiteSpace": "nowrap",
  },
  "desktopPetVoiceControls": { "minHeight": "32px", "display": "flex", "alignItems": "center", "justifyContent": "center", "rowGap": "7px", "columnGap": "7px", "marginTop": "3px", "pointerEvents": "none" },
  "desktopPetVoiceError": {
    "width": "min(210px, calc(100vw - 16px))",
    "maxHeight": "72px",
    "marginTop": "4px",
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": 0,
    "paddingTop": "6px",
    "paddingRight": "8px",
    "paddingBottom": "6px",
    "paddingLeft": "8px",
    "overflowX": "auto",
    "overflowY": "auto",
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
    "pointerEvents": "auto",
    "fontSize": "var(--fs-micro)",
    "lineHeight": 1.35,
  },
  "petDismissDrawer": {
    "position": "fixed",
    "zIndex": 160,
    "left": "50%",
    "bottom": "56px",
    "width": "100px",
    "height": "100px",
    "display": "grid",
    "contain": "layout",
    "placeItems": "center",
    "color": "#fff",
    "pointerEvents": "none",
    "transform": "translateX(-50%)",
  },
  "petDismissDrawerHitbox": {
    "position": "absolute",
    "zIndex": 2,
    "top": "11px",
    "right": "11px",
    "bottom": "11px",
    "left": "11px",
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
  },
  "petDismissDrawerVisual": {
    "display": "grid",
    "placeItems": "center",
    "opacity": 0,
    "transform": "translateY(78px) scale(.58)",
    "transformOrigin": "50% 100%",
    "transition": { "default": "opacity 120ms ease, transform 300ms cubic-bezier(.18,.9,.24,1.28)", "@media (prefers-reduced-motion: reduce)": "none !important" },
    "willChange": "opacity, transform",
  },
  "petDismissDrawerTarget": {
    "position": "relative",
    "width": "68px",
    "height": "68px",
    "display": "grid",
    "placeItems": "center",
    "borderTopLeftRadius": "50%",
    "borderTopRightRadius": "50%",
    "borderBottomRightRadius": "50%",
    "borderBottomLeftRadius": "50%",
    "color": "#fff",
    "backgroundColor": "transparent",
    "backgroundImage": "linear-gradient(145deg, #ff5c55, color-mix(in srgb, var(--danger) 84%, #7d0309))",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "0 10px 28px color-mix(in srgb, var(--danger) 52%, transparent), inset 0 1px 1px rgba(255,255,255,.24)",
    "transition": { "default": "transform 160ms cubic-bezier(.2,.9,.2,1.3), box-shadow 160ms ease, background 160ms ease", "@media (prefers-reduced-motion: reduce)": "none !important" },
    "::after": {
      "content": "''",
      "position": "absolute",
      "top": "-8px",
      "right": "-8px",
      "bottom": "-8px",
      "left": "-8px",
      "borderTopWidth": "2px",
      "borderTopStyle": "solid",
      "borderTopColor": "color-mix(in srgb, var(--danger) 52%, transparent)",
      "borderRightWidth": "2px",
      "borderRightStyle": "solid",
      "borderRightColor": "color-mix(in srgb, var(--danger) 52%, transparent)",
      "borderBottomWidth": "2px",
      "borderBottomStyle": "solid",
      "borderBottomColor": "color-mix(in srgb, var(--danger) 52%, transparent)",
      "borderLeftWidth": "2px",
      "borderLeftStyle": "solid",
      "borderLeftColor": "color-mix(in srgb, var(--danger) 52%, transparent)",
      "borderTopLeftRadius": "inherit",
      "borderTopRightRadius": "inherit",
      "borderBottomRightRadius": "inherit",
      "borderBottomLeftRadius": "inherit",
      "opacity": 0,
      "transform": "scale(.78)",
      "animationName": { "default": null, "@media (prefers-reduced-motion: reduce)": "none !important" },
      "animationDuration": { "default": null, "@media (prefers-reduced-motion: reduce)": "0s !important" },
      "animationDelay": { "default": null, "@media (prefers-reduced-motion: reduce)": "0s !important" },
      "animationTimingFunction": { "default": null, "@media (prefers-reduced-motion: reduce)": "ease !important" },
      "animationIterationCount": { "default": null, "@media (prefers-reduced-motion: reduce)": "1 !important" },
      "animationDirection": { "default": null, "@media (prefers-reduced-motion: reduce)": "normal !important" },
      "animationFillMode": { "default": null, "@media (prefers-reduced-motion: reduce)": "none !important" },
      "animationPlayState": { "default": null, "@media (prefers-reduced-motion: reduce)": "running !important" },
    },
  },
  "petHero": {
    "minHeight": "166px",
    "display": "grid",
    "gridTemplateColumns": { "default": "150px minmax(0, 1fr)", "@media (max-width: 720px)": "100px minmax(0, 1fr)" },
    "alignItems": "center",
    "rowGap": "18px",
    "columnGap": "18px",
    "marginTop": "-8px",
    "marginRight": 0,
    "marginBottom": "28px",
    "marginLeft": 0,
    "paddingTop": "15px",
    "paddingRight": "18px",
    "paddingBottom": "15px",
    "paddingLeft": "18px",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--apex) 24%, var(--border))",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--apex) 24%, var(--border))",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--apex) 24%, var(--border))",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--apex) 24%, var(--border))",
    "borderTopLeftRadius": "16px",
    "borderTopRightRadius": "16px",
    "borderBottomRightRadius": "16px",
    "borderBottomLeftRadius": "16px",
    "backgroundColor": "transparent",
    "backgroundImage": "radial-gradient(circle at 12% 35%, color-mix(in srgb, var(--apex) 15%, transparent), transparent 35%), linear-gradient(135deg, var(--surface-subtle), var(--surface-raised))",
    "backgroundPosition": "0% 0%, 0% 0%",
    "backgroundSize": "auto auto, auto auto",
    "backgroundRepeat": "repeat, repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "paddingInlineStart": { "default": null, "@media (max-width: 720px)": "12px" },
    "paddingInlineEnd": { "default": null, "@media (max-width: 720px)": "12px" },
  },
  "petHeroStage": {
    "minHeight": { "default": "132px", "@media (max-width: 720px)": "112px" },
    "display": "grid",
    "placeItems": "center",
    "borderTopLeftRadius": "32% 47%",
    "borderTopRightRadius": "68% 38%",
    "borderBottomRightRadius": "62% 62%",
    "borderBottomLeftRadius": "38% 53%",
    "backgroundColor": "color-mix(in srgb, var(--apex) 8%, var(--surface-selected))",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "boxShadow": "inset 0 0 0 1px color-mix(in srgb, var(--apex) 16%, transparent)",
  },
  "petKicker": {
    "display": "inline-flex",
    "alignItems": "center",
    "rowGap": "5px",
    "columnGap": "5px",
    "color": "var(--apex)",
    "fontSize": "var(--fs-micro)",
    "fontWeight": 600,
    "letterSpacing": ".06em",
    "textTransform": "uppercase",
  },
  "petGrid": {
    "display": "grid",
    "gridTemplateColumns": { "default": "repeat(2, minmax(0, 1fr))", "@media (max-width: 720px)": "1fr" },
    "rowGap": "8px",
    "columnGap": "8px",
    "paddingTop": "12px",
  },
  "petChoice": {
    "minHeight": "78px",
    "display": "grid",
    "gridTemplateColumns": "58px minmax(0, 1fr)",
    "alignItems": "center",
    "rowGap": "9px",
    "columnGap": "9px",
    "paddingTop": "8px",
    "paddingRight": "8px",
    "paddingBottom": "8px",
    "paddingLeft": "8px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": { "default": "var(--border)", ":hover": "var(--border-strong)" },
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": { "default": "var(--border)", ":hover": "var(--border-strong)" },
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": { "default": "var(--border)", ":hover": "var(--border-strong)" },
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": { "default": "var(--border)", ":hover": "var(--border-strong)" },
    "borderTopLeftRadius": "var(--radius-lg)",
    "borderTopRightRadius": "var(--radius-lg)",
    "borderBottomRightRadius": "var(--radius-lg)",
    "borderBottomLeftRadius": "var(--radius-lg)",
    "color": "var(--text)",
    "backgroundColor": { "default": "var(--surface-subtle)", ":hover": "var(--surface-hover)" },
    "backgroundImage": { "default": "none", ":hover": "none" },
    "backgroundPosition": { "default": "0% 0%", ":hover": "0% 0%" },
    "backgroundSize": { "default": "auto auto", ":hover": "auto auto" },
    "backgroundRepeat": { "default": "repeat", ":hover": "repeat" },
    "backgroundAttachment": { "default": "scroll", ":hover": "scroll" },
    "backgroundOrigin": { "default": "padding-box", ":hover": "padding-box" },
    "backgroundClip": { "default": "border-box", ":hover": "border-box" },
    "textAlign": "left",
  },
  "petChoiceIsActive": {
    "borderTopColor": "var(--apex)",
    "borderRightColor": "var(--apex)",
    "borderBottomColor": "var(--apex)",
    "borderLeftColor": "var(--apex)",
    "boxShadow": "0 0 0 1px color-mix(in srgb, var(--apex) 30%, transparent)",
  },
  "petChoiceArt": {
    "width": "58px",
    "height": "58px",
    "display": "grid",
    "placeItems": "center",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "borderTopLeftRadius": "var(--radius-lg)",
    "borderTopRightRadius": "var(--radius-lg)",
    "borderBottomRightRadius": "var(--radius-lg)",
    "borderBottomLeftRadius": "var(--radius-lg)",
    "color": "var(--text-tertiary)",
    "backgroundColor": "var(--surface-raised)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
  },
  "petSizeRow": { "alignItems": "center" },
  "petSizeControl": { "minWidth": "226px", "display": "grid", "gridTemplateColumns": "minmax(150px, 1fr) 45px", "alignItems": "center", "rowGap": "11px", "columnGap": "11px" },
})
