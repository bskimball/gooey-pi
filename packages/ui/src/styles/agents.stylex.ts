import * as stylex from '@stylexjs/stylex';
const disclosureInAnimation = stylex.keyframes({
  from: {
    opacity: "0",
    transform: "translateY(-3px)"
  }
});
const sessionStatusBreatheAnimation = stylex.keyframes({
  "0%": {
    "opacity": 1
  },
  "100%": {
    "opacity": 1
  },
  "50%": {
    "opacity": 0.45
  }
});
export const styles = stylex.create({
  "specialistsPanel": {
    "position": "relative",
    "height": "100%",
    "minHeight": 0,
    "display": "flex",
    "flexDirection": "column"
  },
  "specialistsEmpty": {
    "paddingTop": "32px",
    "paddingRight": "22px",
    "paddingBottom": "32px",
    "paddingLeft": "22px",
    "color": "var(--text-secondary)",
    "textAlign": "center"
  },
  "specialistTabstrip": {
    "position": "relative",
    "minHeight": "42px",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "display": "flex",
    "alignItems": "center",
    "paddingTop": "7px",
    "paddingRight": "12px",
    "paddingBottom": "7px",
    "paddingLeft": "12px",
    "overflowX": "auto",
    "overflowY": "hidden",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border)",
    "backgroundColor": "color-mix(in srgb, var(--canvas) 94%, var(--surface-subtle))",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  /** Separates live agents from finished ones in the tab strip. */
  "specialistTabDivider": { "width": "1px", "height": "16px", "flexGrow": 0, "flexShrink": 0, "flexBasis": "auto", "marginTop": 0, "marginRight": "8px", "marginBottom": 0, "marginLeft": "8px", "backgroundColor": "var(--border)" },
  "specialistTabstripItem": {
    "height": "26px",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "display": "inline-flex",
    "alignItems": "center",
    "rowGap": "5px",
    "columnGap": "5px",
    "paddingTop": 0,
    "paddingRight": "9px",
    "paddingBottom": 0,
    "paddingLeft": "9px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": {
      "default": "var(--border)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--border-strong)"
      },
      ":focus-visible": "var(--border-strong)"
    },
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": {
      "default": "var(--border)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--border-strong)"
      },
      ":focus-visible": "var(--border-strong)"
    },
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": {
      "default": "var(--border)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--border-strong)"
      },
      ":focus-visible": "var(--border-strong)"
    },
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": {
      "default": "var(--border)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--border-strong)"
      },
      ":focus-visible": "var(--border-strong)"
    },
    "borderTopLeftRadius": "999px",
    "borderTopRightRadius": "999px",
    "borderBottomRightRadius": "999px",
    "borderBottomLeftRadius": "999px",
    "position": "relative",
    "isolation": "isolate",
    "--status-tint": "transparent",
    "color": {
      "default": "var(--text-secondary)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--text)"
      },
      ":focus-visible": "var(--text)"
    },
    "backgroundColor": {
      "default": "var(--surface-raised)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--surface-hover)"
      }
    },
    "backgroundImage": {
      "default": "none",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "none"
      }
    },
    "backgroundPosition": {
      "default": "0% 0%",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "0% 0%"
      }
    },
    "backgroundSize": {
      "default": "auto auto",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "auto auto"
      }
    },
    "backgroundRepeat": {
      "default": "repeat",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "repeat"
      }
    },
    "backgroundAttachment": {
      "default": "scroll",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "scroll"
      }
    },
    "backgroundOrigin": {
      "default": "padding-box",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "padding-box"
      }
    },
    "backgroundClip": {
      "default": "border-box",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "border-box"
      }
    },
    "boxShadow": {
      "default": "0 0 0 1.5px var(--canvas)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "0 3px 8px color-mix(in srgb, var(--color-shadow, rgba(0, 0, 0, 0.2)) 70%, transparent), 0 0 0 1.5px var(--canvas)"
      },
      ":focus-visible": "0 3px 8px color-mix(in srgb, var(--color-shadow, rgba(0, 0, 0, 0.2)) 70%, transparent), 0 0 0 1.5px var(--canvas)"
    },
    "fontSize": "var(--fs-meta)",
    "whiteSpace": "nowrap",
    "cursor": "pointer",
    "transition": "color var(--fast), background-color var(--fast), border-color var(--fast), box-shadow 160ms var(--ease-out), margin-left 160ms var(--ease-out), translate 160ms var(--ease-out)",
    "translate": {
      "default": "0 0",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "0 -2px"
      },
      ":focus-visible": "0 -2px",
      ":active": "0 0"
    },
    "::before": {
      "position": "absolute",
      "top": 0,
      "right": 0,
      "bottom": 0,
      "left": 0,
      "zIndex": -1,
      "borderTopLeftRadius": "inherit",
      "borderTopRightRadius": "inherit",
      "borderBottomRightRadius": "inherit",
      "borderBottomLeftRadius": "inherit",
      "content": "\"\"",
      "backgroundColor": "transparent",
      "backgroundImage": "linear-gradient(135deg, var(--status-tint), transparent 72%)",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "pointerEvents": "none"
    },
    "outlineWidth": {
      "default": null,
      ":focus-visible": "2px"
    },
    "outlineStyle": {
      "default": null,
      ":focus-visible": "solid"
    },
    "outlineColor": {
      "default": null,
      ":focus-visible": "var(--focus)"
    },
    "outlineOffset": {
      "default": null,
      ":focus-visible": "-2px"
    }
  },
  "specialistTabstripItemIsActive": {
    "borderTopColor": "var(--border-strong)",
    "borderRightColor": "var(--border-strong)",
    "borderBottomColor": "var(--border-strong)",
    "borderLeftColor": "var(--border-strong)",
    "color": "var(--text)",
    "backgroundColor": {
      "default": "var(--surface-selected)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--surface-selected)"
      }
    },
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontWeight": 550
  },
  "specialistTabstripItemIsRunning": {
    "--status-tint": "color-mix(in srgb, var(--apex) 14%, transparent)",
    "borderTopColor": "color-mix(in srgb, var(--apex) 36%, var(--border))",
    "borderRightColor": "color-mix(in srgb, var(--apex) 36%, var(--border))",
    "borderBottomColor": "color-mix(in srgb, var(--apex) 36%, var(--border))",
    "borderLeftColor": "color-mix(in srgb, var(--apex) 36%, var(--border))",
    "::before": {
      "animationName": {
        "default": sessionStatusBreatheAnimation,
        "@media (prefers-reduced-motion: reduce)": "none"
      },
      "animationDuration": {
        "default": "2.4s",
        "@media (prefers-reduced-motion: reduce)": "0s"
      },
      "animationDelay": {
        "default": "0s",
        "@media (prefers-reduced-motion: reduce)": "0s"
      },
      "animationTimingFunction": {
        "default": "ease-in-out",
        "@media (prefers-reduced-motion: reduce)": "ease"
      },
      "animationIterationCount": {
        "default": "infinite",
        "@media (prefers-reduced-motion: reduce)": 1
      },
      "animationDirection": {
        "default": "normal",
        "@media (prefers-reduced-motion: reduce)": "normal"
      },
      "animationFillMode": {
        "default": "none",
        "@media (prefers-reduced-motion: reduce)": "none"
      },
      "animationPlayState": {
        "default": "running",
        "@media (prefers-reduced-motion: reduce)": "running"
      }
    }
  },
  "specialistTabstripItemIsWaiting": {
    "--status-tint": "color-mix(in srgb, var(--warning) 12%, transparent)",
    "borderTopColor": "color-mix(in srgb, var(--warning) 40%, var(--border))",
    "borderRightColor": "color-mix(in srgb, var(--warning) 40%, var(--border))",
    "borderBottomColor": "color-mix(in srgb, var(--warning) 40%, var(--border))",
    "borderLeftColor": "color-mix(in srgb, var(--warning) 40%, var(--border))"
  },
  "specialistTabstripItemIsError": {
    "--status-tint": "color-mix(in srgb, var(--danger) 12%, transparent)",
    "borderTopColor": "color-mix(in srgb, var(--danger) 38%, var(--border))",
    "borderRightColor": "color-mix(in srgb, var(--danger) 38%, var(--border))",
    "borderBottomColor": "color-mix(in srgb, var(--danger) 38%, var(--border))",
    "borderLeftColor": "color-mix(in srgb, var(--danger) 38%, var(--border))"
  },
  "runState": {
    "height": "20px",
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "display": "inline-flex",
    "alignItems": "center",
    "rowGap": "5px",
    "columnGap": "5px",
    "paddingTop": 0,
    "paddingRight": "8px",
    "paddingBottom": 0,
    "paddingLeft": "7px",
    "borderTopLeftRadius": "999px",
    "borderTopRightRadius": "999px",
    "borderBottomRightRadius": "999px",
    "borderBottomLeftRadius": "999px",
    "color": "var(--success)",
    "backgroundColor": "var(--success-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "var(--fs-micro)",
    "fontWeight": 550,
    "lineHeight": 1,
    "whiteSpace": "nowrap",
    "::before": {
      "width": "5px",
      "height": "5px",
      "borderTopLeftRadius": "50%",
      "borderTopRightRadius": "50%",
      "borderBottomRightRadius": "50%",
      "borderBottomLeftRadius": "50%",
      "backgroundColor": "currentColor",
      "backgroundImage": "none",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "content": "\"\""
    }
  },
  "runStateIsRunning": {
    "color": "var(--apex)",
    "backgroundColor": "var(--apex-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "::before": {
      "display": "none"
    }
  },
  "runStateIsWaiting": {
    "color": "var(--warning)",
    "backgroundColor": "var(--warning-soft)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "runStateIsError": {
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
  "runStateIsStopped": {
    "color": "var(--text-secondary)",
    "backgroundColor": "var(--surface-hover)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "runStateIsClosed": {
    "color": "var(--text-secondary)",
    "backgroundColor": "var(--surface-hover)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "specialistHeader": {
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "maxHeight": "44%",
    "overflowY": "auto",
    "display": "flex",
    "flexDirection": "column",
    "rowGap": "3px",
    "columnGap": "3px",
    "paddingTop": "6px",
    "paddingRight": "12px",
    "paddingBottom": "6px",
    "paddingLeft": "12px",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border)",
    "backgroundColor": "var(--canvas)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "specialistHeaderDetails": {
    "minWidth": 0,
    "fontSize": "var(--fs-meta)"
  },
  "specialistHeaderCaret": {
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "color": "var(--text-tertiary)",
    "transition": {
      "default": "transform 160ms var(--ease-out), color var(--fast)",
      "@media (prefers-reduced-motion: reduce)": "none"
    }
  },
  "specialistHeaderAgent": {
    "minWidth": 0,
    "overflowX": "hidden",
    "overflowY": "hidden",
    "color": "var(--text)",
    "fontSize": "var(--fs-ui)",
    "fontWeight": 600,
    "textOverflow": "ellipsis",
    "whiteSpace": "nowrap"
  },
  "specialistHeaderHandle": {
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "paddingTop": "1px",
    "paddingRight": "5px",
    "paddingBottom": "1px",
    "paddingLeft": "5px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "var(--border-subtle)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "var(--border-subtle)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border-subtle)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "var(--border-subtle)",
    "borderTopLeftRadius": "var(--radius-xs)",
    "borderTopRightRadius": "var(--radius-xs)",
    "borderBottomRightRadius": "var(--radius-xs)",
    "borderBottomLeftRadius": "var(--radius-xs)",
    "color": "var(--text-tertiary)",
    "backgroundColor": "var(--surface-subtle)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "fontSize": "10.5px",
    "lineHeight": 1.35
  },
  "specialistHeaderTurns": {
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "color": "var(--text-tertiary)",
    "fontSize": "var(--fs-micro)",
    "fontVariantNumeric": "tabular-nums",
    "whiteSpace": "nowrap"
  },
  "specialistHeaderBody": {
    "display": "flex",
    "flexDirection": "column",
    "rowGap": "7px",
    "columnGap": "7px",
    "marginTop": "6px",
    "paddingTop": "8px",
    "paddingRight": "10px",
    "paddingBottom": "8px",
    "paddingLeft": "10px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "var(--border-subtle)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "var(--border-subtle)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border-subtle)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "var(--border-subtle)",
    "borderTopLeftRadius": "var(--radius-md)",
    "borderTopRightRadius": "var(--radius-md)",
    "borderBottomRightRadius": "var(--radius-md)",
    "borderBottomLeftRadius": "var(--radius-md)",
    "backgroundColor": "var(--surface-subtle)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box",
    "animationName": disclosureInAnimation,
    "animationDuration": "180ms",
    "animationDelay": "0s",
    "animationTimingFunction": "var(--ease-out)",
    "animationIterationCount": "1",
    "animationDirection": "normal",
    "animationFillMode": "both",
    "animationPlayState": "running"
  },
  "specialistHeaderMeta": {
    "display": "flex",
    "flexWrap": "wrap",
    "rowGap": "4px",
    "columnGap": "4px"
  },
  "specialistHeaderMission": {
    "marginTop": 0,
    "marginRight": 0,
    "marginBottom": 0,
    "marginLeft": 0,
    "display": "-webkit-box",
    "WebkitLineClamp": 3,
    "WebkitBoxOrient": "vertical",
    "overflowX": "hidden",
    "overflowY": "hidden",
    "color": "var(--text-secondary)",
    "fontSize": "var(--fs-meta)",
    "lineHeight": 1.45
  },
  "specialistHeaderSource": {
    "display": "block",
    "color": "var(--text-tertiary)",
    "fontSize": "var(--fs-micro)",
    "lineHeight": 1.4
  },
  "specialistHeaderPrompt": {
    "maxHeight": "160px",
    "overflowY": "auto",
    "paddingTop": "6px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "var(--border)"
  },
  "specialistFiles": {
    "fontSize": "var(--fs-meta)"
  },
  "specialistFilesCaret": {
    "flexGrow": 0,
    "flexShrink": 0,
    "flexBasis": "auto",
    "color": "var(--text-tertiary)",
    "transition": {
      "default": "transform 160ms var(--ease-out)",
      "@media (prefers-reduced-motion: reduce)": "none"
    }
  },
  "specialistHeaderActivity": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "6px",
    "columnGap": "6px",
    "paddingTop": "5px",
    "paddingRight": "8px",
    "paddingBottom": "5px",
    "paddingLeft": "8px",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "fontSize": "var(--fs-meta)",
    "minWidth": 0,
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "var(--border-subtle)",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "var(--border-subtle)",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "var(--border-subtle)",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "var(--border-subtle)",
    "color": "var(--text-secondary)",
    "backgroundColor": "var(--surface-subtle)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "specialistHeaderError": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "6px",
    "columnGap": "6px",
    "paddingTop": "5px",
    "paddingRight": "8px",
    "paddingBottom": "5px",
    "paddingLeft": "8px",
    "borderTopLeftRadius": "var(--radius-sm)",
    "borderTopRightRadius": "var(--radius-sm)",
    "borderBottomRightRadius": "var(--radius-sm)",
    "borderBottomLeftRadius": "var(--radius-sm)",
    "fontSize": "var(--fs-meta)",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--danger) 28%, var(--border))",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--danger) 28%, var(--border))",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--danger) 28%, var(--border))",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--danger) 28%, var(--border))",
    "color": "var(--danger)",
    "backgroundColor": "color-mix(in srgb, var(--danger-soft) 60%, transparent)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "specialistsPanelBody": {
    "flexGrow": 1,
    "flexShrink": 1,
    "flexBasis": "0%",
    "minHeight": 0,
    "paddingTop": "10px",
    "paddingRight": "12px",
    "paddingBottom": "28px",
    "paddingLeft": "12px",
    "display": "flex",
    "flexDirection": "column"
  },
  "specialistTranscript": {
    "display": "flex",
    "flexDirection": "column",
    "rowGap": "6px",
    "columnGap": "6px"
  },
  "specialistTurn": {
    "display": "flex",
    "flexDirection": "column",
    "minWidth": 0
  },
  "specialistTurnUser": {
    "marginBottom": "4px"
  },
  "specialistTurnLabel": {
    "color": "var(--text)",
    "fontSize": "var(--fs-meta)",
    "fontWeight": 550
  },
  "specialistTurnMeta": {
    "marginLeft": "auto",
    "color": "var(--text-tertiary)",
    "fontSize": "var(--fs-micro)",
    "fontVariantNumeric": "tabular-nums"
  },
  "specialistTurnAssistant": {
    "rowGap": "6px",
    "columnGap": "6px"
  },
  "specialistTurnDivider": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "8px",
    "columnGap": "8px",
    "marginTop": "6px",
    "marginRight": 0,
    "marginBottom": "2px",
    "marginLeft": 0,
    "color": "var(--text-tertiary)",
    "fontSize": "var(--fs-micro)",
    "fontVariantNumeric": "tabular-nums",
    "::before": {
      "height": "1px",
      "flexGrow": 1,
      "flexShrink": 1,
      "flexBasis": "0%",
      "backgroundColor": "var(--border-subtle)",
      "backgroundImage": "none",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "content": "\"\""
    },
    "::after": {
      "height": "1px",
      "flexGrow": 1,
      "flexShrink": 1,
      "flexBasis": "0%",
      "backgroundColor": "var(--border-subtle)",
      "backgroundImage": "none",
      "backgroundPosition": "0% 0%",
      "backgroundSize": "auto auto",
      "backgroundRepeat": "repeat",
      "backgroundAttachment": "scroll",
      "backgroundOrigin": "padding-box",
      "backgroundClip": "border-box",
      "content": "\"\""
    }
  },
  "specialistTurnWorking": {
    "display": "flex",
    "alignItems": "center",
    "rowGap": "6px",
    "columnGap": "6px",
    "paddingTop": "4px",
    "paddingRight": "6px",
    "paddingBottom": "4px",
    "paddingLeft": "6px",
    "color": "var(--text-secondary)",
    "fontSize": "var(--fs-meta)"
  },
  "specialistResult": {
    "marginTop": "8px",
    "paddingTop": "11px",
    "paddingRight": "13px",
    "paddingBottom": "11px",
    "paddingLeft": "13px",
    "borderTopWidth": "1px",
    "borderTopStyle": "solid",
    "borderTopColor": "color-mix(in srgb, var(--success) 26%, var(--border))",
    "borderRightWidth": "1px",
    "borderRightStyle": "solid",
    "borderRightColor": "color-mix(in srgb, var(--success) 26%, var(--border))",
    "borderBottomWidth": "1px",
    "borderBottomStyle": "solid",
    "borderBottomColor": "color-mix(in srgb, var(--success) 26%, var(--border))",
    "borderLeftWidth": "1px",
    "borderLeftStyle": "solid",
    "borderLeftColor": "color-mix(in srgb, var(--success) 26%, var(--border))",
    "borderTopLeftRadius": "var(--radius-md)",
    "borderTopRightRadius": "var(--radius-md)",
    "borderBottomRightRadius": "var(--radius-md)",
    "borderBottomLeftRadius": "var(--radius-md)",
    "backgroundColor": "var(--surface-raised)",
    "backgroundImage": "none",
    "backgroundPosition": "0% 0%",
    "backgroundSize": "auto auto",
    "backgroundRepeat": "repeat",
    "backgroundAttachment": "scroll",
    "backgroundOrigin": "padding-box",
    "backgroundClip": "border-box"
  },
  "specialistJump": {
    "position": "absolute",
    "zIndex": 4,
    "left": "50%",
    "bottom": "12px",
    "transform": "translateX(-50%)",
    "minHeight": "28px",
    "paddingTop": 0,
    "paddingRight": "12px",
    "paddingBottom": 0,
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
    "borderTopLeftRadius": "999px",
    "borderTopRightRadius": "999px",
    "borderBottomRightRadius": "999px",
    "borderBottomLeftRadius": "999px",
    "color": "var(--text)",
    "backgroundColor": {
      "default": "var(--surface-raised)",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "var(--surface-hover)"
      }
    },
    "backgroundImage": {
      "default": "none",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "none"
      }
    },
    "backgroundPosition": {
      "default": "0% 0%",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "0% 0%"
      }
    },
    "backgroundSize": {
      "default": "auto auto",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "auto auto"
      }
    },
    "backgroundRepeat": {
      "default": "repeat",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "repeat"
      }
    },
    "backgroundAttachment": {
      "default": "scroll",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "scroll"
      }
    },
    "backgroundOrigin": {
      "default": "padding-box",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "padding-box"
      }
    },
    "backgroundClip": {
      "default": "border-box",
      "@media (hover: hover) and (pointer: fine)": {
        "default": null,
        ":hover": "border-box"
      }
    },
    "boxShadow": "var(--shadow-popover)",
    "fontSize": "var(--fs-meta)",
    "fontWeight": 550,
    "cursor": "pointer",
    "transition": "background-color var(--fast), border-color var(--fast)"
  }
});
