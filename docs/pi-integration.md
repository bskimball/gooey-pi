# Pi integration

Pi (`pi`, [pi.dev](https://pi.dev/)) is GooeyPi's agent runtime.

## Pi 1.5.0 compatibility

- External CLI release: [Pi 1.5.0](https://github.com/earendil-works/pi/releases/tag/v1.5.0). Root dependencies `@earendil-works/chord`, `pi-ai`, `pi-durable`, and `pi-schema` are pinned to `1.5.0`.
- `browser-agent/` uses `pi-schema` builders (the upgraded libraries no longer provide transitive `typebox`). Injected extensions resolve schemas via Pi's host loader.
- `postinstall` applies a local, idempotent, version-scoped Pi Durable 1.5.0 submission-wait cancellation fix (checks for an aborted context before registering a `Session` read waiter).
- Desktop and VS Code share `PiModeControl` (`apex-ui`). The mode parser accepts decorated labels (`Utopia · +Sidekick`, `Apex · Inline`). Utopia remains distinct under Hydra: it shows ordinary model/thinking controls and the Hydra tier selector (sending `/mode utopia` and `/mode hydra standard|high|max|off|sync`), not Fusion pair controls.
- Session metadata stores Utopia as `behaviorMode: 'utopia:<tier>'` (or `'utopia'` without Hydra) and reads its model from `models.utopia`; the disposable metadata cache is invalidated so previously misparsed sessions rescan.

## CLI flags and paths

- **Executable**: `pi` (`pi.exe` on Windows; resolved via `$PI_BINARY`, `PATH`, bounded shared dirs, and `pi.cmd` -> `@earendil-works/pi-coding-agent/dist/cli.js`).
- **Spawn (`pi --mode rpc`)**:
  - **No `--cwd` flag**: the runtime manager spawns `pi` with the authorized working directory as the child process `cwd`.
  - **Resume**: `--session <path>` (exact file path; never use interactive `--resume`).
  - **Model / thinking**: `--provider <name> --model <id>` and `--thinking <off|minimal|low|medium|high|xhigh|max>`.
  - **Extensions**: `--extension <path>` (`-e <path>`) per injected capability extension.
  - **Model catalog probe**: `pi --mode rpc --no-session --offline` sending `get_available_models` (`--list-models` prints a table even under `--mode json`). Probe uses single-flight, TTL, byte-bounded stdout, kill-on-timeout, and sanitized env.
- **Paths**:
  - Agent dir: `~/.pi/agent/` (`settings.json`, `extensions/`, `skills/`, `models-store.json`, `auth.json`, `trust.json`).
  - Sessions: `~/.pi/agent/sessions/--<cwd-with-slashes-as-dashes>--/<ISO-timestamp-dashes>_<uuidv7>.jsonl`.
- **Session format (v3 JSONL)**:
  - Header: `{"type":"session","version":3,"id":"<uuidv7>","timestamp":"<ISO>","cwd":"<abs path>"}`.
  - Tree entries linked by `id`/`parentId` (`parentId: null` roots): `message`, `model_change` (split `provider` + `modelId`), `thinking_level_change`, `compaction`, `branch_summary`, `custom`, `custom_message`, `label`, and `session_info` (latest `name` wins).
  - Session JSONL is read-only; offline rename is disabled.

## RPC protocol

- **Transport**: JSONL request/response (`{type:'response', id, command, success, data|error}`). No startup `ready` frame, protocol negotiation, or chunked frames. Handshake is `get_state` -> `get_session_stats`.
- **`get_state`**: returns `model`, `thinkingLevel`, `isStreaming`, `isCompacting`, `steeringMode`, `followUpMode`, `sessionId`, `autoCompactionEnabled`, `messageCount`, `pendingMessageCount`. Does not return `serviceTier`, `fastModeEnabled`, or `contextUsage` (`readState` returns `{}`).
- **`get_session_stats`**: returns `contextUsage: {tokens, contextWindow, percent}`, `cost`, and `tokens: {input, output, cacheRead, cacheWrite, total}`, which map to `RuntimeInfo.sessionUsage` and `session_usage` events.
- **Supported commands**: `get_state`, `get_available_models`, `get_session_stats`, `set_session_name` (also emits `session_info_changed`), `get_commands`, `fork`, `get_fork_messages`. Unknown commands return `success: false`.
- **Fast mode**: `set_service_tier` maps to `/gooeypi-fast-mode default|priority` via prompt RPC. The bundled `pi-work-fast-mode.ts` extension updates runtime-local state and sets `service_tier` on supported OpenAI Codex requests in `before_provider_request`.
- **Unsupported commands** (rejected with error): `send_message`, `set_heartbeat`, `update_heartbeat`, `manage_heartbeat`, `observe`, `unobserve`, `list_heartbeats`, `get_heartbeat`, `agent_messages_*` (`clone` semantics also differ). Approval-mode selection is unavailable (Pi has no permission prompt system).

## Capability extensions

Injected extensions use Pi's `(pi) => void` / `pi.registerTool` API and live under `assets/extensions/`:

- `apex-browser.ts`: browser capability bridge.
- `apex-browser-agent.ts`: injected with the browser capability; adds `browser_run` (batched role/name steps with expectations and page diff) and `browser_task` (delegated to a Pi Durable sub-agent). Lazily imports `APEX_BROWSER_AGENT_RUNTIME_PATH` (built from `browser-agent/` by `scripts/build-browser-agent.mjs`) and passes host `ctx.modelRegistry`. Model selection: tool `model` argument -> `APEX_BROWSER_AGENT_MODEL` -> session model.
- `apex-schedules.ts`: scheduled tasks tool surface.
- `apex-collaboration.ts`: app-owned top-level session collaboration tools (see `docs/session-collaboration.md`).
- `apex-ask-user.ts`: injected only when **Ask user** is enabled (off by default on fresh installs).

For packages, skills, and `pi-mcp-adapter` MCP integration, see `docs/capability-integrations.md`.

## Security invariants

Same rules as `docs/security.md`:

- Spawn commands use fixed executables and argv arrays only (no shell interpolation) with sanitized child environments.
- Pi session root paths are canonicalized and containment-checked; session JSONL files are never mutated.
- All RPC, stdout, and event limits are bounded.
- `~/.pi/agent/auth.json` and `trust.json` are never read or written (`piDisabledProviders` controls picker visibility only).
- IPC allowlists are fixed; all Pi CLI/RPC output is treated as untrusted input.
