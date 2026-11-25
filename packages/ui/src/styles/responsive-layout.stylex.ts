import * as stylex from '@stylexjs/stylex';
export const projectItemMarker = stylex.defineMarker();
export const styles = stylex.create({
  "terminalDrawer": {
    "height": {
      "default": "var(--terminal-height, clamp(260px, 34vh, 390px))",
      "@media (max-width: 720px)": {
        "default": "var(--terminal-height, 46vh)"
      }
    },
    "flexBasis": {
      "default": "var(--terminal-height, clamp(260px, 34vh, 390px))",
      "@media (max-width: 720px)": {
        "default": "var(--terminal-height, 46vh)"
      }
    }
  },
  "panelScrim": {
    "display": {
      "default": "none",
      "@media (max-width: 980px)": {
        "default": "block"
      }
    }
  },
  "conversationPane": {
    "minWidth": {
      "default": "360px",
      "@media (max-width: 1180px)": {
        "default": "360px"
      },
      "@media (max-width: 980px)": {
        "default": 0
      }
    }
  },
  "conversationBottomDock": {
    "paddingTop": {
      "default": 0,
      "@media (max-width: 720px)": {
        "default": 0
      }
    },
    "paddingRight": {
      "default": "24px",
      "@media (max-width: 720px)": {
        "default": "9px"
      }
    },
    "paddingBottom": {
      "default": "12px",
      "@media (max-width: 720px)": {
        "default": "8px"
      }
    },
    "paddingLeft": {
      "default": "24px",
      "@media (max-width: 720px)": {
        "default": "9px"
      }
    }
  },
  "composerWrap": {
    "left": {
      "default": "24px",
      "@media (max-width: 720px)": {
        "default": "9px"
      }
    },
    "right": {
      "default": "24px",
      "@media (max-width: 720px)": {
        "default": "9px"
      }
    },
    "bottom": {
      "default": "13px",
      "@media (max-width: 720px)": {
        "default": "8px"
      }
    }
  },
  "composer": {
    "minHeight": {
      "default": 106,
      "@media (max-width: 720px)": {
        "default": "118px"
      }
    }
  },
  "composerFooter": {
    "alignItems": {
      "default": "center",
      "@media (max-width: 720px)": {
        "default": "flex-end"
      }
    }
  },
  "composerControls": {
    "minWidth": {
      "default": 0,
      "@container (max-width: 620px)": {
        "default": 0
      }
    },
    "flexWrap": {
      "default": "wrap",
      "@container (max-width: 490px)": {
        "default": "wrap"
      },
      "@media (max-width: 720px)": {
        "default": "wrap"
      }
    }
  },
  "changesBody": {
    "gridTemplateColumns": {
      "default": "190px minmax(0, 1fr)",
      "@media (max-width: 1180px)": {
        "default": "155px minmax(0, 1fr)"
      }
    }
  },
  "inspector": {
    "position": {
      "default": "relative",
      "@media (max-width: 980px)": {
        "default": "fixed"
      }
    },
    "zIndex": {
      "default": 10,
      "@media (max-width: 980px)": {
        "default": 80
      }
    },
    "width": {
      "default": "var(--inspector-width, clamp(340px, 42vw, 410px))",
      "@media (max-width: 980px)": {
        "default": "min(620px, calc(100vw - 50px))"
      },
      "@media (max-width: 720px)": {
        "default": "calc(100vw - 50px)"
      }
    },
    "minWidth": {
      "default": "340px",
      "@media (max-width: 980px)": {
        "default": 0
      }
    },
    "flexBasis": {
      "default": "var(--inspector-width, clamp(340px, 42vw, 410px))",
      "@media (max-width: 980px)": {
        "default": "auto"
      }
    }
  },
  "inspectorTabs": {
    "height": {
      "default": "43px",
      "@media (max-width: 720px)": {
        "default": "45px"
      }
    },
    "paddingLeft": {
      "default": "12px",
      "@media (max-width: 720px)": {
        "default": "6px"
      }
    }
  },
  "sidebar": {
    "position": {
      "default": "relative",
      "@media (max-width: 980px)": {
        "default": "fixed"
      }
    },
    "height": {
      "default": "100%",
      "@media (max-width: 980px)": {
        "default": "auto"
      }
    },
    "width": {
      "default": "var(--sidebar-width, 252px)",
      "@media (max-width: 980px)": {
        "default": "min(268px, calc(100vw - 50px))"
      }
    },
    "flexBasis": {
      "default": "var(--sidebar-width, 252px)",
      "@media (max-width: 980px)": {
        "default": "min(268px, calc(100vw - 50px))"
      }
    }
  },
  "terminalDrawerMaximized": {
    "height": {
      "default": "auto",
      "@media (max-width: 720px)": {
        "default": "auto"
      }
    },
    "flexBasis": {
      "default": "auto",
      "@media (max-width: 720px)": {
        "default": "auto"
      }
    }
  },
  "trafficLightClearanceToolbar": {
    "width": {
      "default": "62px",
      "@media (max-width: 720px)": {
        "default": "64px"
      }
    },
    "flexBasis": {
      "default": "62px",
      "@media (max-width: 720px)": {
        "default": "64px"
      }
    }
  },
  "titleToolbarIdentity": {
    "justifyContent": {
      "default": "flex-start",
      "@media (max-width: 980px)": {
        "default": "center"
      }
    }
  },
  "messageUser": {
    "columnGap": {
      "default": "12px",
      "@media (max-width: 720px)": {
        "default": "9px"
      }
    }
  },
  "agentMessageSummary": {
    "minHeight": {
      "default": "34px",
      "@media (max-width: 720px)": {
        "default": "44px"
      }
    }
  },
  "activityToolSummary": {
    "minHeight": {
      "default": "28px",
      "@media (max-width: 720px)": {
        "default": "44px"
      }
    }
  },
  "activityToolState": {
    "display": {
      "default": "inline-flex",
      "@media (max-width: 720px)": {
        "default": "none"
      }
    }
  },
  "transcript": {
    "paddingTop": {
      "default": "36px",
      "@media (max-width: 720px)": {
        "default": "20px"
      }
    }
  },
  "pageContainer": {
    "paddingTop": {
      "default": 0,
      "@media (max-width: 720px)": {
        "default": "25px"
      }
    },
    "paddingRight": {
      "default": 0,
      "@media (max-width: 720px)": {
        "default": "18px"
      }
    },
    "paddingBottom": {
      "default": 0,
      "@media (max-width: 720px)": {
        "default": "55px"
      }
    },
    "paddingLeft": {
      "default": 0,
      "@media (max-width: 720px)": {
        "default": "18px"
      }
    }
  },
  "pageHeader": {
    "alignItems": {
      "default": "flex-start",
      "@media (max-width: 720px)": {
        "default": "stretch"
      }
    },
    "marginBottom": {
      "default": "14px",
      "@media (max-width: 720px)": {
        "default": "18px"
      }
    }
  },
  "pageTools": {
    "alignItems": {
      "default": "center",
      "@media (max-width: 720px)": {
        "default": "stretch"
      }
    },
    "paddingBottom": {
      "default": "10px",
      "@media (max-width: 720px)": {
        "default": "8px"
      }
    }
  },
  "activityToolsRight": {
    "width": {
      "default": "100%",
      "@media (max-width: 720px)": {
        "default": "100%"
      }
    }
  },
  "pageContainerPageContainer": {
    "paddingTop": {
      "default": "38px",
      "@media (max-width: 720px)": {
        "default": "25px"
      }
    },
    "paddingRight": {
      "default": "34px",
      "@media (max-width: 720px)": {
        "default": "18px"
      }
    },
    "paddingBottom": {
      "default": "70px",
      "@media (max-width: 720px)": {
        "default": "55px"
      }
    },
    "paddingLeft": {
      "default": "34px",
      "@media (max-width: 720px)": {
        "default": "18px"
      }
    }
  },
  "pluginHeader": {
    "alignItems": {
      "default": "flex-end",
      "@media (max-width: 720px)": {
        "default": "flex-start"
      }
    }
  },
  "directoryTools": {
    "alignItems": {
      "default": "center",
      "@media (max-width: 720px)": {
        "default": "stretch"
      }
    }
  },
  "directoryList": {
    "gridTemplateColumns": {
      "default": "repeat(2, minmax(0, 1fr))",
      "@media (max-width: 980px)": {
        "default": "1fr"
      }
    }
  },
  "pageHeaderPageHeader": {
    "alignItems": {
      "default": "flex-start",
      "@media (max-width: 720px)": {
        "default": "stretch"
      }
    },
    "marginBottom": {
      "default": "28px",
      "@media (max-width: 720px)": {
        "default": "18px"
      }
    }
  },
  "projectItemActions": {
    "opacity": {
      "default": 0,
      [stylex.when.ancestor(":hover", projectItemMarker)]: 1,
      [stylex.when.ancestor(":focus-within", projectItemMarker)]: 1,
      "@media (max-width: 720px)": {
        "default": 1,
        [stylex.when.ancestor(":hover", projectItemMarker)]: 1,
        [stylex.when.ancestor(":focus-within", projectItemMarker)]: 1
      }
    }
  },
  "scheduleEditorGrid": {
    "gridTemplateColumns": {
      "default": "1fr 1fr",
      "@media (max-width: 720px)": {
        "default": "1fr"
      }
    }
  },
  "scheduleDateFields": {
    "gridTemplateColumns": {
      "default": "1.2fr .8fr",
      "@media (max-width: 490px)": {
        "default": "1fr"
      }
    }
  },
  "scheduleExecutionGrid": {
    "gridTemplateColumns": {
      "default": "1.2fr .8fr .65fr",
      "@media (max-width: 720px)": {
        "default": "1fr 1fr"
      },
      "@media (max-width: 490px)": {
        "default": "1fr"
      }
    }
  },
  "scheduleFastToggle": {
    "minHeight": {
      "default": "47px",
      "@media (max-width: 720px)": {
        "default": "48px"
      }
    }
  },
  "scheduleDetailActions": {
    "display": {
      "default": "flex",
      "@media (max-width: 490px)": {
        "default": "grid"
      }
    }
  },
  "scheduleDetailCard": {
    "minHeight": {
      "default": "148px",
      "@media (max-width: 720px)": {
        "default": 0,
        ":nth-child(odd)": 0,
        ":nth-last-child(-n+2)": 0
      }
    },
    "borderRightWidth": {
      "default": null,
      ":nth-child(odd)": "1px",
      "@media (max-width: 720px)": {
        "default": 0,
        ":nth-child(odd)": 0,
        ":nth-last-child(-n+2)": 0
      }
    },
    "borderRightStyle": {
      "default": null,
      ":nth-child(odd)": "solid",
      "@media (max-width: 720px)": {
        "default": "none",
        ":nth-child(odd)": "none",
        ":nth-last-child(-n+2)": "none"
      }
    },
    "borderRightColor": {
      "default": null,
      ":nth-child(odd)": "var(--border)",
      "@media (max-width: 720px)": {
        "default": "currentColor",
        ":nth-child(odd)": "currentColor",
        ":nth-last-child(-n+2)": "currentColor"
      }
    },
    "borderBottomWidth": {
      "default": "1px",
      ":nth-last-child(-n+2)": 0,
      "@media (max-width: 720px)": {
        "default": "1px",
        ":nth-child(odd)": "1px",
        ":nth-last-child(-n+2)": "1px",
        ":last-child": 0
      }
    },
    "borderBottomStyle": {
      "default": "solid",
      ":nth-last-child(-n+2)": "none",
      "@media (max-width: 720px)": {
        "default": "solid",
        ":nth-child(odd)": "solid",
        ":nth-last-child(-n+2)": "solid",
        ":last-child": "none"
      }
    },
    "borderBottomColor": {
      "default": "var(--border)",
      ":nth-last-child(-n+2)": "currentColor",
      "@media (max-width: 720px)": {
        "default": "var(--border)",
        ":nth-child(odd)": "var(--border)",
        ":nth-last-child(-n+2)": "var(--border)",
        ":last-child": "currentColor"
      }
    }
  },
  "scheduleRun": {
    "gridTemplateColumns": {
      "default": "28px minmax(0, 1fr) auto minmax(90px, auto)",
      "@media (max-width: 720px)": {
        "default": "28px minmax(0, 1fr) auto"
      }
    }
  },
  "scheduleSessionLink": {
    "minHeight": {
      "default": "30px",
      "@media (max-width: 720px)": {
        "default": "36px"
      }
    }
  },
  "pageHeaderSchedulePageHeader": {
    "alignItems": {
      "default": "flex-start",
      "@media (max-width: 720px)": {
        "default": "stretch"
      }
    },
    "marginBottom": {
      "default": "20px",
      "@media (max-width: 720px)": {
        "default": "18px"
      }
    }
  },
  "scheduleLedgerSummary": {
    "rowGap": {
      "default": "20px",
      "@media (max-width: 720px)": {
        "default": "12px"
      }
    },
    "columnGap": {
      "default": "20px",
      "@media (max-width: 720px)": {
        "default": "12px"
      }
    }
  },
  "scheduleRow": {
    "minHeight": {
      "default": "112px",
      "@media (max-width: 720px)": {
        "default": "126px"
      }
    },
    "gridTemplateColumns": {
      "default": "36px minmax(0, 1fr) minmax(132px, auto) 18px",
      "@media (max-width: 720px)": {
        "default": "36px minmax(0, 1fr) 16px"
      }
    },
    "rowGap": {
      "default": "13px",
      "@media (max-width: 720px)": {
        "default": "10px"
      }
    },
    "columnGap": {
      "default": "13px",
      "@media (max-width: 720px)": {
        "default": "10px"
      }
    }
  },
  "scheduleRowStatus": {
    "width": {
      "default": "34px",
      "@media (max-width: 490px)": {
        "default": "32px"
      }
    },
    "height": {
      "default": "34px",
      "@media (max-width: 490px)": {
        "default": "32px"
      }
    }
  },
  "scheduleRowNext": {
    "alignItems": {
      "default": "flex-end",
      "@media (max-width: 720px)": {
        "default": "flex-start"
      }
    },
    "flexDirection": {
      "default": "column",
      "@media (max-width: 720px)": {
        "default": "row"
      }
    },
    "textAlign": {
      "default": "right",
      "@media (max-width: 720px)": {
        "default": "left"
      }
    }
  },
  "settingsRowTextSize": {
    "alignItems": {
      "default": "center",
      "@media (max-width: 490px)": {
        "default": "stretch"
      }
    },
    "rowGap": {
      "default": "18px",
      "@media (max-width: 490px)": {
        "default": "9px"
      }
    },
    "columnGap": {
      "default": "18px",
      "@media (max-width: 490px)": {
        "default": "9px"
      }
    }
  },
  "voiceChoiceRow": {
    "gridTemplateColumns": {
      "default": "minmax(0, 1fr) minmax(220px, 46%)",
      "@media (max-width: 720px)": {
        "default": "1fr"
      }
    },
    "rowGap": {
      "default": "20px",
      "@media (max-width: 720px)": {
        "default": "8px"
      }
    },
    "columnGap": {
      "default": "20px",
      "@media (max-width: 720px)": {
        "default": "8px"
      }
    }
  },
  "voicePathField": {
    "gridTemplateColumns": {
      "default": "minmax(0, 1fr) minmax(300px, 58%)",
      "@media (max-width: 720px)": {
        "default": "1fr"
      }
    },
    "rowGap": {
      "default": "16px",
      "@media (max-width: 720px)": {
        "default": "8px"
      }
    },
    "columnGap": {
      "default": "16px",
      "@media (max-width: 720px)": {
        "default": "8px"
      }
    }
  },
  "voiceBridgeNotice": {
    "gridTemplateColumns": {
      "default": "auto minmax(0, 1fr) auto",
      "@media (max-width: 720px)": {
        "default": "auto minmax(0, 1fr)"
      }
    }
  },
  "voiceConnectionCardBody": {
    "minWidth": {
      "default": 0,
      "@media (max-width: 720px)": {
        "default": "calc(100% - 46px)"
      }
    }
  },
  "voiceSelfHostedAuth": {
    "alignItems": {
      "default": "center",
      "@media (max-width: 720px)": {
        "default": "flex-start"
      }
    }
  },
});
