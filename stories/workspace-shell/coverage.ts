/** Source/export ledger. Story names are real CSF exports, not proposed coverage. */
export const workspaceShellCoverage = [
  {
    source: 'App.tsx',
    exports: ['default'],
    title: 'Workspace/Shell',
    stories: ['Desktop', 'Narrow', 'Dark', 'Loading', 'Empty'],
    mode: 'controlled production-child composition, not full App hooks',
  },
  { source: 'main.tsx', exports: ['root error fallback composition'], title: 'Workspace/Shell', stories: ['RootFailure'], mode: 'real ErrorBoundary/EmptyState/ApexButton; entrypoint never imported' },
  { source: 'components/AppRail.tsx', exports: ['AppRail'], title: 'Workspace/Shell', stories: ['Desktop', 'Narrow', 'Dark'] },
  { source: 'components/TitleToolbar.tsx', exports: ['TitleToolbar'], title: 'Workspace/Shell', stories: ['Desktop', 'Narrow', 'Empty'] },
  { source: 'components/SessionControls.tsx', exports: ['SessionControls'], title: 'Workspace/Shell', stories: ['Desktop', 'Narrow'] },
  { source: 'components/Sidebar.tsx', exports: ['Sidebar'], title: 'Workspace/Shell', stories: ['Desktop', 'Narrow', 'Loading', 'Empty'] },
  { source: 'components/SidebarAttention.tsx', exports: ['WorkingDot', 'SessionStatusGlyph', 'SidebarAttentionGroups'], title: 'Workspace/Shell', stories: ['AttentionAndSubagents', 'Desktop'] },
  { source: 'components/SidebarSubagents.tsx', exports: ['SidebarSubagents'], title: 'Workspace/Shell', stories: ['AttentionAndSubagents', 'Desktop'] },
  { source: 'components/CommandPalette.tsx', exports: ['CommandPalette'], title: 'Workspace/Shell', stories: ['PaletteSearch', 'Desktop'] },
  {
    source: 'components/ResizeHandle.tsx',
    exports: ['ResizeHandle'],
    title: 'Workspace/Shell',
    stories: ['Desktop', 'ActivityInspectorLayout'],
    additional: { title: 'Workspace/Terminal', stories: ['InteractiveShell'] },
  },
  { source: 'components/InspectorShell.tsx', exports: ['InspectorShell'], title: 'Workspace/Shell', stories: ['Desktop', 'Narrow', 'ActivityInspectorLayout'] },
  { source: 'components/ActivityWorkspace.tsx', exports: ['ActivityWorkspace'], title: 'Workspace/Shell', stories: ['ActivityInspectorLayout'] },
  { source: 'components/AppToast.tsx', exports: ['AppToast'], title: 'Workspace/Shell', stories: ['MissingHarnessAndToast', 'Desktop'] },
  { source: 'components/NoHarnessPrompt.tsx', exports: ['NoHarnessPrompt'], title: 'Workspace/Shell', stories: ['MissingHarnessAndToast'] },
  { source: 'components/RuntimeOwnerNotice.tsx', exports: ['RuntimeOwnerNotice'], title: 'Workspace/Shell', stories: ['Desktop', 'Narrow'] },
  { source: 'components/WindowsAppMenu.tsx', exports: ['WindowsAppMenu', 'default alias'], title: 'Workspace/Shell', stories: ['MenuAndProjectRun', 'Desktop'] },
  { source: 'components/ProjectRunControl.tsx', exports: ['ProjectRunControl'], title: 'Workspace/Shell', stories: ['MenuAndProjectRun', 'Desktop'] },
  {
    source: 'components/Inspector.tsx',
    exports: ['Inspector'],
    title: 'Workspace/Inspector',
    stories: ['Overview', 'Changes', 'StageAndUnstage', 'Files', 'Agents', 'Browser', 'NarrowOverlay', 'NoProject'],
  },
  { source: 'components/inspector/SummaryPanel.tsx', exports: ['SummaryPanel'], title: 'Workspace/Inspector', stories: ['Overview', 'SummaryReadiness'] },
  { source: 'components/inspector/SummaryAgentsSection.tsx', exports: ['SummaryAgentsSection'], title: 'Workspace/Inspector', stories: ['AgentOverflow', 'SummaryReadiness'] },
  {
    source: 'components/inspector/RunConfigSection.tsx',
    exports: ['RunConfigSection'],
    title: 'Workspace/Inspector',
    stories: ['RunConfiguration', 'RunConfigurationLoading', 'RunConfigurationFailure'],
  },
  { source: 'components/inspector/SpecialistsPanel.tsx', exports: ['SpecialistsPanel'], title: 'Workspace/Inspector', stories: ['Agents', 'EmptyAgents'] },
  { source: 'components/inspector/SpecialistMatrix.tsx', exports: ['SpecialistFiles'], title: 'Workspace/Inspector', stories: ['ObservedSpecialistFiles', 'SourceNavigationFailure'] },
  {
    source: 'components/inspector/ChangesPanel.tsx',
    exports: ['ChangesPanel', 'internal DiffView'],
    title: 'Workspace/Inspector',
    stories: ['Changes', 'StageAndUnstage', 'CleanChanges', 'UnauthorizedChanges', 'ChangesLoading', 'ChangesFailure'],
  },
  {
    source: 'components/inspector/FilesPanel.tsx',
    exports: ['FilesPanel', 'internal CurrentFilePreview'],
    title: 'Workspace/Inspector',
    stories: ['Files', 'FilesLoading', 'FilesFailure', 'EmptyFiles', 'MultiRootFiles'],
  },
  {
    source: 'components/inspector/BrowserPanel.tsx',
    exports: ['BrowserPanel'],
    title: 'Workspace/Browser',
    stories: ['SharedExtensionTab', 'DisconnectedExtension', 'EmptyBrowserChrome', 'NarrowBrowserChrome'],
  },
  {
    source: 'components/inspector/BrowserAnnotationPopover.tsx',
    exports: ['BrowserAnnotationPopover'],
    title: 'Workspace/Browser',
    stories: ['AnnotationUnknownSource', 'AnnotationValidatedSource', 'AnnotationSourceFailure'],
  },
  { source: 'components/AgentBrowserLayer.tsx', exports: ['AgentBrowserLayer', 'AgentCursorOverlay'], title: 'Workspace/Browser', stories: ['AgentCursorAndLayer', 'SharedExtensionTab'] },
  {
    source: 'components/TerminalDrawer.tsx',
    exports: ['TerminalDrawer', 'internal TerminalView'],
    title: 'Workspace/Terminal',
    stories: ['InteractiveShell', 'BackgroundJobs', 'EmptyDrawer', 'ShellFailure'],
  },
  {
    source: 'components/BackgroundJobView.tsx',
    exports: ['BackgroundJobView'],
    title: 'Workspace/Terminal',
    stories: ['RunningOutput', 'CompletedOutput', 'FailedOutput', 'KilledOutput', 'BackgroundJobs'],
  },
] satisfies Array<{ source: string; exports: string[]; title: string; stories: string[]; mode?: string; additional?: { title: string; stories: string[] } }>

export const sourceRoot = 'apps/desktop/src/'
export const nativeExclusions = [
  'BrowserPanel and AgentBrowserLayer: Electron webview guest execution, webContents identity, attach and native navigation. Browser chrome, extension cards, annotations, placement and pointer overlay remain included.',
  'WindowsAppMenu: OS popup menu contents. The real trigger and browser-rendered category menu remain included; popupMenu is a deterministic local callback.',
  'TerminalDrawer: actual PTY/process creation is replaced by an in-memory host. The real xterm renderer, input, resize, job output, error and controls remain included.',
]
export const verificationNotes = [
  'Full App hooks are not mounted. Desktop/Narrow compose production shell children without importing main.tsx.',
  'Git stage, unstage, restore and successful commit mutate per-installation in-memory status; Inspector refresh reads that status into production ChangesPanel props. No filesystem, git, network, process or native IPC is called.',
  'RunConfigSection currently renders a rejected read like unresolved loading; the failure story preserves this production behavior.',
  'StageAndUnstage asserts production ChangesPanel file counts and navigation.tsx moving between scopes through fixture mutations. Browser execution, visual validation and complete control-flow exercise remain integrated gates.',
]
