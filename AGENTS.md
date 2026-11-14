# AGENTS.md

## Commands

Run from repo root (Node `24.21.0` via `.nvmrc`; run `nvm use` if `node -v` differs):

```bash
npm run dev                  # build browser-agent + launch electron-vite dev
npm run build                # build desktop app
npm run build:all            # build vscode-theme, desktop, and vscode extension
npm run typecheck            # project-wide TypeScript check
npm run check                # oxlint + oxfmt check
npm test                     # vitest unit/integration suite
npm run test:e2e:hermetic    # Playwright Electron e2e (needs built app)
npm run release:verify:package # preflight + vendor check + typecheck + check + coverage + bundle size
```

On headless Linux, wrap GUI/e2e commands with `xvfb-run -a`. Authoritative CI/release gates live in [`docs/validation.md`](docs/validation.md).

## Structure

- `apps/desktop/` — Electron app
  - `electron/main/` — main-process services, IPC, Pi RPC manager, loopback brokers
  - `electron/preload/` — frozen context-isolated preload bridge
  - `src/` — React renderer (`app/`, `components/`, `hooks/`, `lib/`, `pages/`, `styles/`)
  - `assets/extensions/` — bundled Pi capability extensions
  - `browser-agent/` — Pi Durable browser sub-agent runtime
- `packages/`
  - `core/` (`apex-core`) — shared types, JSONL/session parsing, `effect/Schema` validation, collaboration/browser helpers
  - `ui/` (`apex-ui`) — shared React components, Astryx theme setup, StyleX primitives, XState questionnaire machine
  - `vscode/` & `vscode-theme/` — VS Code extension, webview, and theme
  - `browser-extension/` — browser extension integration
- `scripts/` — build, typecheck, and `scripts/release/` verification/packaging scripts
- `tests/` — Vitest (`backend/`, `frontend/`, root gate tests) and Playwright (`e2e/`)

Keep handwritten production files `<= 750` lines when practical; split by cohesive responsibility, not arbitrary wrappers.

## Astryx (`@astryxdesign/core`)

- Prefer `@astryxdesign/core` primitives (`Button`, `Badge`, `Banner`, `Dialog`, `TabList`, `TextInput`, `TextArea`, `Selector`, `EmptyState`).
- Theme `apex` is defined/registered in `packages/ui/src/ui.tsx` (`data-astryx-theme="apex"`).
- Import `@astryxdesign/core/astryx.css` before `apps/desktop/src/styles/astryx-tokens.css` (`layer(astryx-theme)`).

## StyleX (`@stylexjs/stylex`)

- Compiled via `stylex.vite({ runtimeInjection: false, ... })` in `electron.vite.config.ts`.
- Cascade order in `apps/desktop/src/styles.css`:
  `reset, apex-base, astryx-base, astryx-theme, apex, stylex, apex-overrides, apex-sidebar, apex-responsive`.
- Author styles with `stylex.create(...)` and apply with `stylex.props(...)`; keep contextual/sidebar/responsive overrides in their higher layers rather than fighting StyleX specificity.

## Effect (`effect`)

- Used selectively for typed boundary validation (`effect/Schema` in `packages/core/src/validation.ts`) and cancellable async IPC (`effect/Effect` + `AbortController` in `apps/desktop/electron/main/effective-config-ipc.ts`).
- Do not introduce Effect as a global app runtime; XState owns application lifecycle.

## XState (`xstate`, `@xstate/react`)

- v5 API: `setup`, `assign`, `initialTransition`, `transition`, `createActor`.
- Use pure `initialTransition` / `transition` for deterministic state reducers (e.g. `apps/desktop/src/App.tsx`, `packages/core/src/browser/extension-bridge.ts`, `packages/vscode/src/pi-rpc.ts`).
- Use `useMachine` / `useActorRef` / `useSelector` from `@xstate/react` for stateful UI/hooks.

## pstack

Vendored under `.agents/skills/pstack/` with rules in `.cursor/rules/pstack-models.mdc`. If `~/.cursor/rules/pstack-models.mdc` is missing, copy it there before running pstack skills.
