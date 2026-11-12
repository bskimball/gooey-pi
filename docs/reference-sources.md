# Reference and clean-room record

Prime Work is an independently authored desktop client for Prime Agent. It follows common macOS split-view, chat, terminal, browser, and code-review interaction patterns. No proprietary application source code or bundled assets were copied.

Public product references consulted for feature behavior and high-level visual study:

- https://learn.chatgpt.com/docs/app
- https://learn.chatgpt.com/docs/use-chatgpt
- https://learn.chatgpt.com/docs/projects
- https://learn.chatgpt.com/docs/browser
- https://learn.chatgpt.com/docs/integrated-terminal
- https://learn.chatgpt.com/docs/code-review
- https://learn.chatgpt.com/docs/environments/git-worktrees
- https://learn.chatgpt.com/docs/plugins
- https://learn.chatgpt.com/docs/automations
- https://learn.chatgpt.com/docs/app-server

The bundled Persian/Arabic UI face (`public/fonts/vazirmatn-arabic-var.woff2`) is derived from Vazirmatn (© Saber Rastikerdar), licensed under the SIL Open Font License 1.1; the license text ships alongside it as `public/fonts/LICENSE-vazirmatn.txt`. It was produced locally from the unmodified upstream release archive `https://github.com/rastikerdar/vazirmatn/releases/download/v33.003/vazirmatn-v33.003.zip` (release `v33.003`, archive SHA-256 `0a9afd41967e6f57096a56a181a23f81a2b999b62f1f2a4e4b26736580854fdb`) by subsetting `fonts/variable/Vazirmatn[wght].ttf` to the Arabic-script code points declared in the `@font-face` `unicode-range` in `src/styles/base.css`, retaining the `wght` axis and every layout feature: `pyftsubset 'Vazirmatn[wght].ttf' --output-file=vazirmatn-arabic-var.woff2 --flavor=woff2 --with-zopfli --layout-features='*' --name-IDs='*' --name-legacy --notdef-outline --no-hinting --unicodes='U+0600-06FF,U+0750-077F,U+08A0-08FF,U+FB50-FDFF,U+FE70-FEFF,U+200C-200E,U+2010-2011,U+204F,U+2E41'`. The committed subset is 44,604 bytes, SHA-256 `ab1a8bda119e1d380bb3199997ea7d00182fe026ee35c911027dfa54e5add87b`. Renderer assets are not covered by `scripts/release/dependency-pins.json`, which pins executable and npm supply-chain artifacts under `vendor/`; git history over `public/fonts/` and this record form the integrity boundary for the font bytes.

The bundled Latin UI face (`public/fonts/figtree-latin-var.woff2` and `public/fonts/figtree-latin-ext-var.woff2`) is Figtree (© The Figtree Project Authors), licensed under the SIL Open Font License 1.1; the license text ships alongside it as `public/fonts/LICENSE-figtree.txt`. Both files are the unmodified weight-variable subsets from the `@fontsource-variable/figtree@5.3.0` npm package (`files/figtree-latin-wght-normal.woff2`, 20,156 bytes, SHA-256 `4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd`; `files/figtree-latin-ext-wght-normal.woff2`, 10,280 bytes, SHA-256 `bf7828e2c258cffcfa50a048ee388a36b95bc16b452e8d36fa797635dbe15965`), and their `@font-face` `unicode-range` values in `src/styles/base.css` are copied from that package's `index.css`.

The app-icon tile, product name, copy, CSS tokens, components, and application code were authored for this client. OpenAI, ChatGPT, and Codex are trademarks of their respective owner; Apex does not imply affiliation with them.
