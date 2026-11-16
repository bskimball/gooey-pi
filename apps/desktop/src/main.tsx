import { ApexButton, EmptyState } from 'apex-ui'
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
          <EmptyState
            className="app-error-fallback"
            role="alert"
            title="Apex hit an unexpected error"
            action={
              <ApexButton variant="primary" onClick={() => window.location.reload()}>
                Reload Apex
              </ApexButton>
            }
          >
            Reload to continue. Any message you were typing is preserved.
          </EmptyState>
        }
      >
        <App />
      </ErrorBoundary>
    </IconContext.Provider>
  </StrictMode>,
);
