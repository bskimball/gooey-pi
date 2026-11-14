# Packages, extensions, skills, and MCP

GooeyPi exposes one **Capabilities** directory for Pi packages, extensions, skills, and MCP servers.

## Vocabulary

- **Package**: distribution container that can include extensions, skills, prompts, and themes.
- **Extension**: executable JS/TS loaded into the Pi host (installed via a package or placed in a Pi extension directory).
- **Skill**: model-facing guidance.
- **MCP server**: connection definition (`mcpServers` schema), distinct from packages, extensions, and skills.

## Pi capability and MCP contract

| Surface | Contract |
| --- | --- |
| Packages | Installed via `pi install <source>` (`-l` for project scope). |
| Standalone extensions | Absolute local `.js`/`.ts` file installed via `pi install` (`-l` for project scope). |
| MCP runtime | `pi-mcp-adapter` extension (`pi install npm:pi-mcp-adapter`), reading `~/.pi/agent/mcp.json` (global) and `.pi/mcp.json` (project). |
| MCP UI actions | **Add MCP** is disabled until **Pi MCP Adapter** is enabled. When enabled, GooeyPi can create, enable, or disable local stdio entries only. |
| Network MCP and auth | HTTP/SSE and URL-bearing entries (including loopback) are rejected on write. Externally configured network entries are visible but read-only; bounded definition-only removal remains available for cleanup (even when the adapter is disabled). `/mcp-auth` is never launched or forwarded. |

- **Adapter toggle**: state is derived from Pi's installed packages. Enabling runs `pi install npm:pi-mcp-adapter`; disabling disables its package filters without deleting `mcp.json` definitions or credentials.
- **Canonical source rule**: only `npm:pi-mcp-adapter` (optionally with an exact semantic version) authorizes MCP writes; scoped, Git, local-path, and same-name packages do not.
- **Unsupported keys**: local definitions with keys outside GooeyPi's bounded state API remain visible but non-actionable.

## Security boundaries

- **No shell interpolation**: every install/remove command invokes the detected fixed `pi` executable with an argv array.
- **Input validation**: package, plugin, server, command, and argument inputs are bounded and validated in the main process.
- **Extension path safety**: standalone extensions must be absolute local `.js`/`.ts` paths. Project installs are re-authorized, destination directories are pinned against symlink replacement, and existing extension files are never overwritten.
- **Fail-closed network MCP & atomic stdio writes**: network MCP definitions fail closed at service admission and settings writer boundaries. Local stdio writes use GooeyPi's cooperative lock, fingerprint conflict retries, project-directory pinning, atomic replacement, and rollback (definition removal re-verifies the project directory before and after reading each snapshot; lock-ignoring same-user writers can still race the rename).
- **Auth command rejection**: the main-process RPC manager rejects harness auth commands on prompt, steer, and follow-up delivery. Schedules check at create, update, resume, run-now, startup (blocking forbidden persisted active schedules while keeping paused records removable), and execution. Voice task launch, collaboration creation, and peer delivery enforce the same policy.
- **Discovery budget**: MCP rows have an independent 2,500-definition-per-settings-file budget; overflow emits an explicit scope-and-path warning.
- **Cross-instance serialization**: adapter transitions and non-removal MCP writes share an agent-level admission lock; adapter state is re-checked under that lock immediately before mutating `mcp.json`.
- **Credential isolation**: GooeyPi never requests or mutates `mcp:*` credentials in Pi auth storage; definition removal neither inspects nor changes authorization. GooeyPi does not prevent Pi from loading externally configured network MCP entries, but never creates, enables, disables, mutates, or authenticates them.
