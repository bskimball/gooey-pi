# Harness discovery

GooeyPi discovers the Pi executable without invoking a shell or reading shell startup files.

## Resolution order

1. Saved absolute executable override in Harness settings.
2. `PI_BINARY` environment override.
3. Packaged application resources (when bundled).
4. Absolute directories in `PATH` / `Path`.
5. Official Pi installer locations.
6. Shared system and package-manager locations (npm, Bun, pnpm, mise, Volta, Homebrew, Linuxbrew; NVM dirs capped at 64, sorted by descending version).

Candidates are deduplicated, must be executable, and are checked with a bounded shell-free `--version` probe; only exit-zero candidates are published. Broken overrides fall through while retaining their failure reason. If all candidates fail, settings report the override's reason (if set) or the last probed candidate's reason; probe stderr is control-character-stripped and byte-capped.

## Windows and WSL

- **Windows:** Native `pi.exe` is resolved via `Path` or override. For npm's `pi.cmd` shim, GooeyPi verifies `@earendil-works/pi-coding-agent/dist/cli.js` under the npm prefix and launches it directly via `node.exe` without a shell; other shims or forks require an explicit override.
- **WSL:** Windows builds do not treat WSL paths as native Windows executables (WSL requires explicit transport, distribution, cwd conversion, and Linux session roots). Under WSLg, normal Linux discovery applies.
