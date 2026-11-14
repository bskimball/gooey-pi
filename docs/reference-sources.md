# Reference and clean-room record

Apex is an independently authored desktop client for Pi following common split-view, chat, terminal, browser, and code-review patterns. No proprietary source code or bundled assets were copied.

## Bundled fonts (SIL OFL 1.1)

Renderer assets are not covered by `scripts/release/dependency-pins.json`; git history over `public/fonts/` and this record form their integrity boundary (`unicode-range` declared in `src/styles/base.css`).

- `public/fonts/vazirmatn-arabic-var.woff2` (`public/fonts/LICENSE-vazirmatn.txt`): Arabic-script `pyftsubset` of `Vazirmatn[wght].ttf` from Vazirmatn `v33.003` (upstream zip SHA-256 `0a9afd41967e6f57096a56a181a23f81a2b999b62f1f2a4e4b26736580854fdb`). 44,604 bytes, SHA-256 `ab1a8bda119e1d380bb3199997ea7d00182fe026ee35c911027dfa54e5add87b`.
- `public/fonts/figtree-latin-var.woff2` (`public/fonts/LICENSE-figtree.txt`): Unmodified `files/figtree-latin-wght-normal.woff2` from `@fontsource-variable/figtree@5.3.0`. 20,156 bytes, SHA-256 `4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd`.
- `public/fonts/figtree-latin-ext-var.woff2` (`public/fonts/LICENSE-figtree.txt`): Unmodified `files/figtree-latin-ext-wght-normal.woff2` from `@fontsource-variable/figtree@5.3.0`. 10,280 bytes, SHA-256 `bf7828e2c258cffcfa50a048ee388a36b95bc16b452e8d36fa797635dbe15965`.

## Trademarks

The app icon, name, copy, CSS tokens, and code were authored for this client. OpenAI, ChatGPT, and Codex are trademarks of their respective owner; Apex implies no affiliation.
