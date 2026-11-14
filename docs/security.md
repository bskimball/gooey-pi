# Security model

Apex separates remote presentation from privileged local execution. Follow the [vulnerability reporting policy](../.github/SECURITY.md); never post suspected vulnerabilities publicly.

## Renderer, IPC, and local execution

- **Renderer isolation**: No Node integration, sandboxed, context-isolated, frozen preload API. Packaged assets load via path-contained `prime-work://app/` with CSP (`style-src 'unsafe-inline'` only; scripts/connections/objects/frames `'self'`/`'none'`).
- **IPC trust gate**: Calls require the authorized main frame at the packaged URL (or validated loopback dev URL), revoked on navigation/close/shutdown.
- **Pi RPC**: Out-of-process strict-LF JSONL over fixed argv arrays (no shell interpolation). Credentials stay in Pi CLI (`auth.json` untouched). Commands, correlation IDs, byte sizes, and event counts are bounded. Quit closes IPC/admission and escalates TERM/KILL across RPC groups, utilities, PTYs, and descendants.
- **Terminals**: `node-pty` owned by main; renderer receives opaque IDs and bounded byte streams; owner- and project-scoped.
- **Voice & mic**: Mic permission is audio-only on the authorized main renderer. Voice keys use Electron `safeStorage` (fail-closed on macOS Keychain, Windows DPAPI, Linux Keyring/KWallet; no `basic_text` fallback; optional session-only in-memory key when unavailable) in a mode-0600 file. Self-hosted transcription allows HTTP only on loopback/private IPs and requires HTTPS publicly without redirects/URL credentials. Realtime orb pins to one explicit project grant and visible models.
- **Sessions & Markdown**: Session JSONL is read-only and bounded. Markdown strips raw HTML and remote images; fenced HTML runs only in a `default-src 'none'` unique-origin iframe.

## Projects, capabilities, and browser

- **Project grants**: Explicit persisted grants only (`/` and home roots rejected); identity tracks inode + birth time. Session-derived folders get read-only grants (listing, Git status/diff, reveal). Symlinks and generated trees are excluded.
- **Packages & MCP**: Package installs validate registry specs, absolute local paths, or HTTPS/SSH URLs (`git://` rejected; plain HTTP only on loopback). Apex only writes local stdio MCP entries when canonical `npm:pi-mcp-adapter` is enabled, under an agent-level lock with atomic replacement and rollback. HTTP/SSE/URL-bearing MCP entries fail closed and remain read-only (removal only). RPC, schedules, voice, and collaboration reject MCP auth slash commands.
- **Remote browser**: `persist:apex-browser` webviews have Node/preloads/popups/permissions disabled; navigation and downloads (512 MiB, 3 concurrent, 1 GiB/hr) are credential-free HTTP(S).
- **Loopback capability brokers**: Schedules, browser (`apex-browser.ts` + `apex-browser-agent.ts`), and session collaboration (`apex-collaboration.ts`) each use per-runtime random bearer tokens never exposed to the renderer. Tokens bind to an immutable session/project claim; agent outputs are fenced as untrusted. Browser-agent crash recovery aborts interrupted tasks rather than replaying actions. Peer messages use a local HMAC verified before transcript elevation. See [`session-collaboration.md`](session-collaboration.md).
- **TryCUA**: Disabled by default; never bundled or auto-installed. Enabling passes only the detected `cua-driver` path and guidance (no MCP config).

## Persistence, state migration, and packaging

- **State v4 (`prime-work-state-v4.json`)**: Single-instance lock + atomic/fsynced writes. Only Pi-owned project/schedule records grant authority. POSIX migrates via directory-fsynced atomic publish and `.migrated-v4-*` backup; Windows uses an explicit backup + zero-authority v3 marker protocol and quarantines recreated legacy files. Newer or oversized state files open read-only and fail closed.
- **Electron fuses & unpack**: RunAsNode, `NODE_OPTIONS`, debug CLI args, snapshot loading, and extra `file://` privileges are disabled; cookie encryption, ASAR integrity, and `OnlyLoadAppFromAsar` are enabled. Only platform-specific `node-pty` binaries unpack (never ZeroMQ).
- **Packaged smoke**: `--packaged-smoke=<abs path>` writes a mode-0600 readiness marker only after authorized renderer `app:get-meta` bootstrap and quits; ignored in dev and `second-instance`.
- **Release signing**: macOS requires Developer ID + notarization/stapling. Public Windows packaging verifies signer identity against `GOOEYPI_WINDOWS_CERT_SUBJECT` and/or `GOOEYPI_WINDOWS_CERT_THUMBPRINT`; when neither is configured, public Windows packaging fails closed. Releases build only from semantic tags on `main` and publish `SHA256SUMS.txt` + GitHub build provenance.

## Dependency pinning and supply chain

- `scripts/release/bootstrap-npm.mjs` verifies the vendored npm archive's size and SHA-512 against `scripts/release/dependency-pins.json`. Before invoking npm's installer, it requires a regular non-symlink file and installs offline with `--ignore-scripts`. The archive is excluded from packaged apps.
- `npm run vendor:verify-patches` rejects legacy `prime-agent` or `@earendil-works/pi-(agent-core|ai|tui)` artifacts.
- `npm run audit:production` enforces [`audit-exceptions.json`](../scripts/release/audit-exceptions.json) (reason + unexpired date; stale exceptions fail).
