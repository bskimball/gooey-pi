/** Two VS Code-only rendered families. Reused shared/desktop components are not counted twice. */
export const vscodeCoverage = [
  {
    source: 'packages/vscode/webview/SessionPicker.tsx',
    family: 'SessionPicker',
    title: 'VS Code/Session picker',
    storyIds: [
      'vs-code-session-picker--closed',
      'vs-code-session-picker--active-owned-and-long-titles',
      'vs-code-session-picker--loading',
      'vs-code-session-picker--empty',
      'vs-code-session-picker--catalog-error',
      'vs-code-session-picker--switch-error',
      'vs-code-session-picker--switch-session',
      'vs-code-session-picker--keyboard-navigation',
      'vs-code-session-picker--dark',
      'vs-code-session-picker--narrow',
    ],
  },
  {
    source: 'packages/vscode/webview/App.tsx',
    family: 'App',
    title: 'VS Code/App',
    storyIds: [
      'vs-code-app--ready-standalone',
      'vs-code-app--no-host-state',
      'vs-code-app--starting',
      'vs-code-app--exited',
      'vs-code-app--desktop-connected',
      'vs-code-app--streaming-with-queue',
      'vs-code-app--editor-file',
      'vs-code-app--dirty-selection',
      'vs-code-app--multiple-selections',
      'vs-code-app--single-line-selection',
      'vs-code-app--editor-excluded',
      'vs-code-app--agents-pane',
      'vs-code-app--return-to-chat',
      'vs-code-app--extension-prompt',
      'vs-code-app--extension-tab',
      'vs-code-app--dark',
      'vs-code-app--narrow-desktop-composition',
    ],
  },
] as const
export const vscodeExclusions = [
  {
    source: 'packages/vscode/webview/host.ts',
    reason:
      'Native acquireVsCodeApi transport is replaced before evaluation by the foundation alias. Actual editor commands, screenshot resizing, and native browser pop-out are excluded operations. Host-message state/reset/editorContext/git/browserState/extensionUi and posted ready/response are wired to the real App with a safe fixture. RequestId correlation remains pending, not claimed by these direct fixture methods.',
  },
  { source: 'packages/vscode/webview/main.tsx', reason: 'Mount/theme entrypoint. Never imported in stories; Storybook owns theme and lifecycle.' },
  { source: 'packages/vscode/webview/transcript.ts', reason: 'Reducer, exercised by App reset operations.' },
  { source: 'packages/vscode/webview/sessionPickerMachine.ts', reason: 'State machine exercised by catalog and keyboard/switch stories.' },
  { source: 'packages/vscode/webview/{apex.css,session-controls.stylex.ts,webview.stylex.ts}', reason: 'Styling support, not separate UI.' },
  { source: 'packages/vscode/src/**', reason: 'Native extension implementation and protocol types. No additional webview UI families.' },
] as const
