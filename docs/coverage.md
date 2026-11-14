# Coverage gate

[`scripts/release/coverage-inventory.ts`](../scripts/release/coverage-inventory.ts) recursively enrolls runtime files from seven first-party families and passes glob-escaped exact include patterns to [`vitest.config.ts`](../vitest.config.ts) (which anchors root via `import.meta.url`). New files enter the denominator automatically; symlinks, missing roots, overlapping families, and malformed entries fail configuration.

## Thresholds

Global floors: **65% statements / 50% branches / 70% functions / 75% lines**. Per-family floors:

| Family | Floor st/br/fn/ln (%) |
|---|---|
| `electron/main` | 77 / 71 / 76 / 83 |
| `electron/preload` | 100 / 100 / 100 / 100 |
| `src/app` | 92 / 88 / 93 / 94 |
| `src/lib` | 90 / 85 / 92 / 92 |
| `src/hooks` | 56 / 46 / 59 / 64 |
| `scripts/release` | 63 / 58 / 79 / 66 |
| `assets/extensions` | 59 / 45 / 54 / 63 |

## Policy

- **No exclusions:** Directory and glob exclusions are not representable; single-file technical exclusions require a substantive reason and compensating verification. Currently **no technical exclusions** exist (child-process CLI tests remain uncovered in the denominator).
- **Always evaluated:** `reportOnFailure: true` ensures coverage and thresholds still run when tests fail.
- **Verification:** [`tests/coverage-inventory.test.ts`](../tests/coverage-inventory.test.ts) locks the inventory, thresholds, and exclusion rules. Record before/after denominator, artifact-size, and wall-clock evidence per [`validation.md`](validation.md#recording-evidence) when changing families, thresholds, or exclusions.
