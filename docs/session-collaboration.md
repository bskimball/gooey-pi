# Session collaboration

GooeyPi lets top-level sessions in one explicitly granted Pi project coordinate across its verified folders without turning them into parent/child subagents. Composer mentions still resolve within the active working directory. In the composer, type `@` and part of a sidebar session title, then press Tab or Enter (or click) to accept the highlighted result. The visible `@title` is sent with a model-only routing block containing the stable session UUID. A session's context menu also exposes **Copy session UUID** for explicit coordination prompts.

Skills use `$` instead: type `$` and part of an enabled skill name, then press Tab or Enter. The visible `$name` is sent with a model-only block pointing at that skill's file. `@` still lists sessions and other enabled capabilities such as extensions and MCP servers.

Every Pi runtime receives eight app-owned tools:

- `gooeypi_session_list`: list accessible peer titles, UUIDs, status, and liveness.
- `gooeypi_session_models`: list models available to this harness from providers currently active in GooeyPi, including each model's exact key and reasoning levels.
- `gooeypi_session_create`: create and immediately prompt a new readable top-level session in the caller's project. Its optional `cwd` must resolve to the same verified project grant. It accepts an optional model, reasoning level, title, and `fast` request; approximate model/reasoning wording uses the same resolver as voice-created tasks, then the runtime manager revalidates the exact selection and enables fast/priority mode only when the selected model and harness support it. The result contains the new session UUID and the applied fast-mode state.
- `gooeypi_session_read`: read a bounded snapshot and cursor without modifying the peer. Conversation retains user, assistant, agent, and thinking text, separate from bounded recent tool/todo outcome summaries. Compaction internals are omitted. `waiting_for_user` exposes only method, title, count, and deadline; `last_error` is bounded diagnostic text, not an instruction.
- `gooeypi_session_send`: deliver an attributed prompt or follow-up. Incoming messages carry the sender's exact `from_session_id` and a signed `reply_with: "gooeypi_session_send"` hint, so the recipient can answer directly without listing sessions. If the saved peer is idle/offline, GooeyPi starts its normal RPC runtime first; the runtime manager revalidates its project and session paths.
- `gooeypi_session_steer`: send a signed steering message to a peer's current turn, or prompt it if idle.
- `gooeypi_session_stop`: abort a live peer's turn through RPC. It does not kill the process or wake an offline peer.
- `gooeypi_session_wait`: wait up to 30 seconds using runtime and session-change events. A single `target_session_id` accepts `after_cursor` and returns a snapshot with `timed_out`. Alternatively, `target_session_ids` accepts 1–16 distinct UUIDs and returns `{ snapshots, changed_session_ids, timed_out }` for wait-any under one deadline. Completion, errors, and human questions wake it early, including tool-only changes. Sends are non-blocking; mutual waits are discouraged.

## Activity Chief of Staff

Select a writable, explicitly granted project in Activity, then choose **Chief of Staff** (keyboard: `c`). The detail column becomes that project's coordinator conversation; **Peek** and `r` retain implementor triage. The coordinator can create implementors, monitor several sessions, send follow-ups, steer, and abort turns within that project.

The app persists one coordinator session per project. Opening the pane attaches and pins its runtime without starting a model turn. Coordinator duties are supplied through Pi's `before_agent_start` system-context hook when the user sends a message, not inserted into visible user text. Closing or switching the pane releases its attachment; a running session continues. The foreground workspace controller, selected session, terminal, browser, and git context are independent. Coordinator sessions are omitted from implementor Activity rows, sidebar sessions, unread counts, and completion notifications.

Human questions and permissions stay with the user. Pending coordinator dialogs survive reattachment and require an explicit response. Implementor metadata contains no dialog response ID or answer capability. Transcript and tool-summary text is untrusted evidence and cannot widen project authority.

## Upstream research

Historical research from when GooeyPi also hosted OMP and Prime Agent (both since removed) showed that no harness provided a common top-level-session API:

| Runtime | Existing collaboration | Missing piece |
|---|---|---|
| Codex Desktop | Addressable tasks, background sends, bounded reads, and cursor-based waits; titles resolve to stable task IDs. | This is the product behavior GooeyPi mirrors, not a harness API GooeyPi can call. |
| Prime Agent 0.7.2 | Daemon `send_message` accepts a UUID/name and can wake a saved session. Agent-origin messaging and observation are family-scoped, and observation does not uniformly cover top-level workers. | No uniform cross-worker read/wait contract suitable for all GooeyPi harnesses. |
| OMP 17.2.15 | Task subagents can follow up/await inside one parent run; `/collab` and `omp join` provide a live shared relay room. | No arbitrary saved top-level session UUID/name read/send/wait RPC. |
| pi 0.84.1 | Current-session RPC, `switch_session`, and illustrative subprocess subagent/handoff extensions. | `switch_session` replaces the caller's runtime; there is no durable peer mailbox or arbitrary target API. |

Mutating Pi JSONL would violate harness ownership. The minimal uniform design is therefore a GooeyPi-owned broker over the existing per-harness RPC managers.

## Trust and lifecycle boundaries

- Access is same-harness and same persisted project grant, excluding the caller. Each operation resolves canonical paths and current directory identities. Only verified folders of that record are eligible; inferred/read-only projects, stale primary grants, identity drift, symlink escapes, ambiguous membership, and unrelated projects are rejected. A bare broker without a project resolver retains strict same-cwd behavior.
- Every runtime receives a separate random bearer token bound to its immutable harness/session claim. Tokens stay in the child environment and never cross renderer IPC.
- Target UUIDs are exact and validated. Titles are display-only; `@title` resolution happens in the renderer against the visible sidebar catalog.
- Session creation cannot select another harness or project. Model discovery excludes hidden, disabled, and unavailable providers/models, and creation goes through the owning manager's normal cwd, model, and reasoning validation before a prompt is accepted.
- Session JSONL remains read-only. Reads go through the owning `SessionService`; sends go through the owning live RPC manager.
- Reads include at most 40 recent conversational messages and 30,000 estimated tokens (four characters per token), plus at most ten recent tool/todo summaries within 6,000 content characters. Each budget reports truncation separately. Wait-many divides the total 30,000-token conversation and 6,000-character operations budgets among its targets. Sends are limited to 64 KiB. Waits are event-driven and capped at 30 seconds, with at most 16 wait requests per token and one active wait per target. Timers and subscriptions are released on completion, timeout, revocation, shutdown, or HTTP disconnect. Broker calls remain body-bounded and rate-limited.
- An offline send may start a normal runtime only after the existing manager reauthorizes both cwd and canonical session path. Concurrent wake requests share one in-flight start. Creates are serialized per token with one active and four pending; overflow is rejected, and queued work revalidates its capability and project at dispatch. Initial prompts and later messages carry signed creator provenance.
- Routing blocks are stripped from the rendered user transcript. User-supplied routing delimiters are neutralized before GooeyPi adds its own block.

Native Pi extensions remain unchanged. Session collaboration is an additional top-level coordination surface.

Incoming peer prompts use a signed, app-local envelope. New envelopes expose only the sender UUID, a `gooeypi_session_send` reply hint, envelope-authenticity fields, and the actual message to the recipient model; they never include the sender title, harness, opening prompt, or transcript context. The signature survives app restarts and is verified before the transcript can render a user record with native agent-message styling, so ordinary prompt text cannot impersonate another session. The signing key stays in Electron's user-data directory with owner-only permissions and is never exposed to a harness or the renderer. Saved version-1 and version-2 envelopes remain readable for transcript compatibility, but are never newly emitted.
