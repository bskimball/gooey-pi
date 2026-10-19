# Harness discovery

GooeyPi discovers the Pi executable without invoking a shell or evaluating shell startup files. This keeps startup bounded and makes detection independent of whether the user prefers bash, zsh, fish, or no interactive shell at all.

## Resolution order

Each refresh checks, in order:

1. The absolute executable override saved in Harness settings.
2. The environment override (`PI_BINARY`).
3. Packaged application resources, when Pi can be bundled.
4. Absolute directories in the process `PATH`/`Path` snapshot.
5. Official Pi installer locations.
6. Shared system and package-manager locations for npm, Bun, pnpm, mise, Volta, Homebrew, and Linuxbrew. NVM version-manager directories are bounded to 64 entries and sorted by descending version.

Candidates are deduplicated and must be executable. GooeyPi then runs a bounded `--version` probe with no shell; only an exit-zero candidate is published to the renderer. A broken override therefore falls through to later automatic candidates, but its own missing, permission, spawn, exit, timeout, or output-limit reason is retained for the settings card. If no candidate works, the card reports the configured override's reason when present, otherwise the last probed candidate's reason. Probe stderr is control-character-stripped and byte-capped before it crosses IPC.

The relevant upstream install layouts are documented by [Pi](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/README.md), [npm](https://docs.npmjs.com/files/folders.html), [Bun](https://bun.sh/docs/installation), [pnpm](https://pnpm.io/settings/other#globalbindir), [mise](https://mise.jdx.dev/dev-tools/shims.html), and [Volta](https://docs.volta.sh/guide/getting-started).

## Windows and WSL boundaries

Native `pi.exe` releases are discoverable through `Path` or an explicit override.

Pi's official npm install on Windows creates a `pi.cmd` shim instead of a native executable. GooeyPi recognizes only that shim declared on the harness descriptor, verifies the fixed entrypoint beneath the npm prefix (`@earendil-works/pi-coding-agent/dist/cli.js`), finds a runnable `node.exe`, and launches the entrypoint directly without a command shell. Community forks or other layouts are not recognized; use the explicit override with a native executable instead.

A Windows app also does not treat an executable inside a WSL distribution as a native Windows path. WSL execution requires an explicit transport, distribution selection, Windows/Linux cwd conversion, and Linux-owned session roots. If GooeyPi itself runs as a Linux application under WSLg, normal Linux discovery applies.
