# Component inventory

Storybook is the local design-review catalog for Apex. It renders the production React components with the production CSS, StyleX compilation, Astryx theme, icons, and bundled fonts. It does not launch Electron or connect to a running Apex session.

## Run it

```bash
npm run storybook
```

Open `http://127.0.0.1:6006`. The server binds to loopback, does not open a browser automatically, and fails rather than taking another port if 6006 is occupied.

```bash
npm run typecheck:storybook
npm run build-storybook
```

The static build is written to `tmp/storybook`. No cloud account or Chromatic subscription is required. Screenshot regression CI is separate from this catalog.

## Review the design

```text
Foundations          production typography, colors, controls
Shared               controls, icons, feedback, dialogs
Chat                 composer, transcript, rich content, task workflows
Workspace            navigation, panels, terminal, pages, settings, activity
VS Code              editor-panel components and compositions
```

Use the theme toolbar to compare light and dark. Use the motion toolbar to compare reduced and normal motion. Compare state galleries before reviewing compositions: the former expose differences in control sizing and state treatment; the latter expose spacing, density, hierarchy, and alignment between components.

Stories contain sample data. They are not views into real projects, files, sessions, credentials, or agent runs. A story's callbacks and controls operate only on its fixture state.

## Coverage and ownership

The `coverage.ts` files beneath `stories/` map source components to story titles and exports. Shared re-exports and implementation helpers are not separate component families. A child component can be covered by a named composition when that composition renders it in a useful, inspectable state.

When adding or changing UI:

1. Add or update the story in the corresponding `stories/` family.
2. Include the relevant empty, populated, loading, disabled, and error states, rather than duplicating states the component does not support.
3. Update the family's coverage map, including the source path and concrete story.
4. Run the Storybook typecheck and build, then inspect the changed story in a browser.

Import actual production components. Do not copy their markup into a story or add production-only switches to make them previewable.

## Host boundary

Browser fixtures live in `.storybook/`. Host-dependent stories use explicit typed fixtures, with deterministic data and local event subscriptions. Unsupported operations fail clearly instead of contacting a real host. Story cleanup resets the dedicated Storybook environment.

Native integration behavior is outside browser review: Electron guest execution and webContents identity, operating-system menu contents, real PTYs, editor commands, credential storage, audio hardware, and live agent or realtime services. Their renderable controls and status UI still belong in the catalog. Use the real application's integration checks for those native operations.

Do not attach this catalog to an Electron preload, a live session bridge, or a real VS Code extension host. Do not reuse another session's running app or terminate an existing process to free the Storybook port.
