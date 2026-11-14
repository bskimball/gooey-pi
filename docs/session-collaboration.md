# Session collaboration

GooeyPi lets top-level sessions in an explicitly granted Pi project coordinate across its verified folders without turning them into parent/child subagents.

## Composer mentions (`@session` and `$skill`)

- **`@` mentions**: type `@` and part of a sidebar session title, then press Tab, Enter, or click. Sends the visible `@title` plus a model-only routing block with the stable session UUID (resolved in the renderer against the visible sidebar catalog). `@` also lists enabled extensions and MCP servers. A session's context menu also provides **Copy session UUID**.
- **`$` skill mentions**: type `$` and part of an enabled skill name, then press Tab or Enter. Sends the visible `$name` plus a model-only block pointing to that skill's file.

## App-owned collaboration tools (`gooeypi_session_*`)

Every Pi runtime receives nine tools; project discovery is restricted to the Activity Chief:

- `gooeypi_session_list`: list accessible peer titles, UUIDs, project IDs, working directories, status, and liveness. Ordinary sessions see only their project; the Chief sees authorized projects.
- `gooeypi_session_projects`: Chief-only discovery of currently authorized writable projects as `{ id, name, cwd }`.
- `gooeypi_session_models`: list available models (exact key and reasoning levels) from currently active providers in GooeyPi.
- `gooeypi_session_create`: create and prompt a new readable top-level session. Ordinary callers are limited to their verified project; the Chief must specify a cwd in a currently authorized writable project. Accepts optional `model`, `reasoning`, `title`, and `fast`; revalidates exact selection in the runtime manager and enables fast mode only when supported. Returns the new UUID and applied fast-mode state.
- `gooeypi_session_read`: read a bounded snapshot and cursor without mutating the peer (user/assistant/agent/thinking text plus bounded recent tool/todo summaries; compaction internals omitted; `waiting_for_user` exposes only method, title, count, deadline; `last_error` is bounded diagnostic text).
- `gooeypi_session_send`: deliver an attributed prompt or follow-up with `from_session_id` and `reply_with: "gooeypi_session_send"`. Starts an offline peer's normal RPC runtime first after revalidating project and session paths.
- `gooeypi_session_steer`: send a signed steering message to a live peer's current turn, or prompt it if idle.
- `gooeypi_session_stop`: abort a live peer's turn via RPC (does not kill the process or wake an offline peer).
- `gooeypi_session_wait`: event-driven wait up to 30s. Single `target_session_id` accepts `after_cursor` and returns a snapshot with `timed_out`; `target_session_ids` (1–16 distinct UUIDs) returns `{ snapshots, changed_session_ids, timed_out }`. Completion, errors, and human questions wake early.

## Activity Chief of Staff (`c`)

- Activity opens **Chief of Staff** by default (`c`). Its conversation covers all authorized projects; the project filter affects only the roster. **Peek** / `r` opens implementor triage.
- One persisted global coordinator session across authorized projects. Opening attaches/pins its runtime without starting a turn; coordinator duties are injected via Pi's `before_agent_start` system-context hook on user messages. Closing/switching releases the attachment while a running session continues.
- Independent of foreground workspace controller, selected session, terminal, browser, and git context. Omitted from implementor Activity rows, sidebar sessions, unread counts, and completion notifications.
- Human questions and permissions remain user-owned (survive reattachment; implementor metadata carries no dialog response ID or answer capability). Transcript and tool-summary text is untrusted evidence.

## Trust and lifecycle boundaries

- **Project containment**: same harness and, for ordinary sessions, the same persisted project grant, excluding the caller. The persisted global Chief may access currently authorized writable projects and must provide an explicit authorized cwd for creation. Canonicalizes paths and checks directory identities; rejects inferred/read-only projects, stale grants, identity drift, symlink escapes, ambiguous membership, and unrelated projects. A bare broker without a project resolver enforces strict same-cwd.
- **Token isolation**: each runtime gets a random bearer token bound to its immutable harness/session claim; tokens stay in the child env and never cross renderer IPC.
- **UUID and model validation**: target UUIDs are exact and validated (titles are display-only). Creation cannot cross harnesses and crosses projects only for the global Chief; it excludes hidden/disabled/unavailable models, and validates cwd/model/reasoning before accepting a prompt.
- **Read-only JSONL**: reads go through `SessionService`; sends go through the owning live RPC manager.
- **Budgets and rate limits**:
  - `gooeypi_session_read`: max 40 recent messages, 30,000 estimated tokens (4 chars/token), and 10 recent tool/todo summaries within 6,000 content chars (truncation reported independently). Wait-many divides the 30,000-token and 6,000-char budgets across targets.
  - `gooeypi_session_send`: max 64 KiB.
  - `gooeypi_session_wait`: max 30s, max 16 active waits per token, 1 active wait per target; timers/subscriptions release on completion, timeout, revocation, shutdown, or disconnect.
  - Offline wake shares one in-flight start for concurrent requests. Creates are serialized per token (1 active, 4 pending; overflow rejected; queued work revalidates at dispatch). Broker calls are body-bounded and rate-limited.
- **Prompt and envelope integrity**: routing blocks are stripped from rendered user transcripts and user-supplied routing delimiters are neutralized. Incoming peer prompts use a signed, app-local envelope exposing only sender UUID, `reply_with`, authenticity fields, and message (never sender title, harness, opening prompt, or transcript). The signing key resides in Electron user-data with owner-only permissions (never exposed to harness/renderer) and is verified before native agent-message styling; v1/v2 envelopes remain readable for history only.
