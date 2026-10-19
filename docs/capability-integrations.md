# Packages, extensions, skills, and MCP

GooeyPi presents one capability directory for Pi. This document defines the
product contract for that surface.

## Shared vocabulary

- A **package** is a distribution container. Pi packages can
  contain extensions, skills, prompts, and themes.
- An **extension** is executable JavaScript or TypeScript loaded into the agent
  host. Installing an extension means installing its package or placing its
  file in a Pi extension directory.
- A **skill** is model-facing guidance.
- An **MCP server** is a connection definition. It is not itself a package,
  extension, or skill, although a package may provide one or more of those
  resources and may declare MCP servers.

## Pi contract

| Harness | Installable bundle | Standalone extension | MCP runtime | MCP actions available in GooeyPi | Network MCP and authentication |
| --- | --- | --- | --- | --- | --- |
| Pi | `pi install <source>` | Local file through `pi install`; `-l` for project scope | `pi-mcp-adapter` extension package | With the adapter enabled, create/enable/disable local stdio definitions; bounded definition removal remains available for cleanup | Configure HTTP/SSE and authenticate through the adapter outside GooeyPi |

The app labels this surface **Capabilities**. Its Add button
first opens a capability-type chooser, then a type-specific form: **Add MCP**,
**Add Package**, and **Add Extension**. The MCP choice remains visible but
disabled until the **Pi MCP Adapter** toggle is enabled. Adapter-enabled Pi
offers only local stdio input fields. The initial Add chooser warns that third-party code may use CLI-only
APIs and links directly to GooeyPi's GitHub issue form for failures; the base
Capabilities screen and the follow-up forms do not repeat that notice.

## Product behavior

### Pi

Pi core has no MCP client. GooeyPi shows **Pi MCP Adapter** as a real
toggle whose state is derived from Pi's installed packages. Enabling it runs
`pi install npm:pi-mcp-adapter`; disabling preserves the installed package and
records its Pi package filters as disabled. Disabling does not delete MCP definitions or credentials, so a
later re-enable restores the connections without silently losing user data.

Only while the adapter is enabled may GooeyPi create or change local stdio
entries in its supported `mcp.json` schema; definition-only removal remains
available while disabled. It rejects HTTP, SSE, and any URL-bearing
definition, including loopback URLs, and never launches `/mcp-auth`. Network
configuration and authentication must be run through the adapter outside
GooeyPi; GooeyPi does not forward `/mcp-auth` prompts.
Externally configured network entries remain visible but are read-only in the
app; bounded definition-only removal remains available for cleanup.
Only the canonical `npm:pi-mcp-adapter` source (optionally followed by an exact
semantic version) satisfies this prerequisite. Scoped, Git, local-path, and
same-name package sources do not authorize MCP writes.
Adapter-enabled local definitions with keys outside GooeyPi's bounded state
API remain visible but non-actionable, with direct-harness management detail.

## Security boundaries

- Every install/remove command uses the detected fixed harness executable and
  an argv array; no shell interpolation is permitted.
- Package, plugin, server, command, and argument inputs are bounded and
  validated in the main process.
- Standalone extensions must be absolute local JavaScript or TypeScript files.
  Project installs are re-authorized and their destination directories remain
  pinned against symlink replacement; existing extension files are never
  overwritten.
- Network MCP definitions fail closed at the service admission and settings
  writer boundaries. State mutation also rejects externally configured network
  entries. The local stdio settings path uses GooeyPi's cooperative lock,
  fingerprint-based conflict retries, project-directory pinning, atomic
  replacement, and rollback protections; definition removal re-verifies the
  project directory immediately before and after reading each update snapshot.
  This is not a filesystem compare-and-swap: a same-user writer that ignores the
  lock can replace the file after the final fingerprint check and race GooeyPi's
  rename, so that writer's update may be overwritten.
- The main-process RPC manager rejects harness authentication commands for
  prompt, steer, and follow-up delivery. Scheduled prompts are
  checked at create, update, resume, and run-now admission before project
  validation or queuing; startup blocks forbidden persisted active schedules
  before missed-run recovery and timer arming, while paused records remain
  available for cleanup and are checked if resumed. The executor repeats the
  check as defense in depth. Voice task launch,
  collaboration creation, and peer delivery preflight the same shared policy
  before queuing, wake-up, delivery, or runtime start.
- MCP rows use an independent 2,500-definition-per-settings-file discovery
  budget. Unrelated catalog records cannot consume it, and exceeding it emits
  an explicit scope-and-path warning.
- Pi adapter transitions and non-removal MCP writes share an agent-level
  admission lock across service instances. Adapter state is re-checked while
  that lock is held, immediately before the settings mutation.
- GooeyPi never requests or mutates `mcp:*` credentials in Pi auth storage.
  Definition removal does not inspect or change
  authorization.
- GooeyPi does not claim to prevent a harness from loading network MCP entries
  configured outside the app. Its guarantee is narrower: GooeyPi does not
  create, enable, disable, mutate, or authenticate those entries.
