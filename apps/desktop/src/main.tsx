import * as stylex from '@stylexjs/stylex'
import { styles as pagesStyles } from 'apex-ui/styles/pages.stylex'
import { styles as workbenchStyles } from 'apex-ui/styles/workbench.stylex'
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { IconContext } from "./components/icons";
import { saveComposerDraftFromDom } from "./lib/composer-draft";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Apex root element was not found");

const ICON_CONTEXT = { weight: "regular" as const };

createRoot(root).render(
  <StrictMode>
    <IconContext.Provider value={ICON_CONTEXT}>
      <ErrorBoundary
        onCatch={saveComposerDraftFromDom}
        fallback={
          <div className={`empty-state app-error-fallback ${stylex.props(pagesStyles.emptyState).className ?? ""}`} role="alert">
            <h2>Apex hit an unexpected error</h2>
            <p>Reload to continue. Any message you were typing is preserved.</p>
            <div className={`empty-state__action ${stylex.props(pagesStyles.emptyStateAction).className ?? ""}`}>
              <button
                type="button"
                className={`button button--primary ${stylex.props(workbenchStyles.button, workbenchStyles.buttonPrimary).className ?? ""}`}
                onClick={() => window.location.reload()}
              >
                Reload Apex
              </button>
            </div>
          </div>
        }
      >
        <App />
      </ErrorBoundary>
    </IconContext.Provider>
  </StrictMode>,
);
