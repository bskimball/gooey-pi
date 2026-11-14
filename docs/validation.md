# Validation guide

Reproducing and interpreting Apex validation gates. A pass applies only to the exact commit, runner, inputs, and credentials that produced it.

## Protected `main` validation contract

`main` branch protection requires PRs, **Require branches to be up to date before merging** (`required_status_checks.strict: true`), and these seven required checks:

- `production-audit`
- `quality`
- `hermetic-e2e`
- `windows-state-migration`
- `packaging-smoke (macos-14, mac, arm64, --config.mac.identity=null)`
- `packaging-smoke (ubuntu-22.04, linux, x64)`
- `packaging-smoke (windows-2022, win, x64)`

Do not require `local-qa-package`: it is manual `workflow_dispatch` only.

## Sources of truth

| Concern | Definition |
|---|---|
| PR / `main` / manual CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| Tagged public releases | [`.github/workflows/release.yml`](../.github/workflows/release.yml) |
| Scheduled dependency audit | [`.github/workflows/audit.yml`](../.github/workflows/audit.yml) |
| Scripts & toolchain | [`package.json`](../package.json), [`.nvmrc`](../.nvmrc), [`package-lock.json`](../package-lock.json) |
| Install & packaging | [`install-app-deps.mjs`](../scripts/release/install-app-deps.mjs), [`package.mjs`](../scripts/release/package.mjs), [`verify-package.mjs`](../scripts/release/verify-package.mjs), [`verify-cross-platform-package.mjs`](../scripts/release/verify-cross-platform-package.mjs) |
| Audit policy & exceptions | [`docs/security.md`](security.md), [`audit-production.mjs`](../scripts/release/audit-production.mjs), [`audit-exceptions.json`](../scripts/release/audit-exceptions.json) |

## Reproducible setup

```bash
nvm install && nvm use
npm run toolchain:bootstrap
npm ci
npm run release:preflight:toolchain
```

`toolchain:bootstrap` installs the `packageManager`-pinned npm offline before `npm ci`. Installing with `--ignore-scripts` skips Electron and native-addon setup; see [`README.md`](../README.md#run-from-source) for recovery.

## Pull-request and branch CI

| Job | When it runs | Establishes |
|---|---|---|
| `production-audit` | PR, `main`, manual | Exception-aware production dependency audit passes. |
| `quality` | PR, `main`, manual | Typecheck, lint/format check, coverage thresholds, bundle build, bundle-size budgets. |
| `hermetic-e2e` | PR, `main`, manual | Built app passes Playwright Electron e2e on macOS. |
| `windows-state-migration` | PR, `main`, manual | Windows state migration, restart, and update suite passes on `windows-2022`. |
| `packaging-smoke` | PRs only | Unsigned unpacked builds + ASAR/native-unpack layout checks on macOS arm64, Linux x64, Windows x64. |
| `local-qa-package` | Manual only | Unsigned local-QA installers/artifacts for macOS, Linux, Windows. |

## Local aggregate commands

| Command | Scope |
|---|---|
| `npm run release:verify:package` | Toolchain preflight, vendor patch check, typecheck, `check`, coverage, production bundle, bundle-size gate. |
| `npm run release:verify` | `release:verify:package` + `test:e2e:hermetic`. |
| `npm run test:e2e` | Build + `test:e2e:hermetic`. |
| `npm run audit:production` | Live npm production audit against `audit-exceptions.json` (requires network). |
| `npm run package:mac:local-qa` | macOS unsigned/unnotarized DMG + ZIP QA build and checks. |
| `npm run package:linux:local-qa` | Linux QA build and runtime layout checks. |
| `npm run package:win:local-qa` | Windows QA build and runtime layout checks. |

Package commands must run on their target OS/architecture. Local-QA builds are not signed/notarized public releases.

## Dependency audit policy

- `npm run audit:production` fails on unaccepted **high**/**critical** advisories, expired entries in [`audit-exceptions.json`](../scripts/release/audit-exceptions.json), and stale exceptions.
- A passing gate means no *unaccepted* high/critical advisories, not zero advisories.

## Public release validation

Triggered by a semantic-version tag matching both package manifests on `main` (or manual dispatch naming an existing tag):

| Release job | Responsibility |
|---|---|
| `validate` | Verify toolchain, tag/manifest versions, `main` ancestry; emit immutable release SHA. |
| `production-audit` | Run `audit:production` on that SHA before packaging. |
| `quality` | Run `release:verify:package` on that SHA. |
| `hermetic-e2e` | Build and run Electron e2e on that SHA. |
| `package` | Build macOS arm64 + x64 with Developer ID signing, notarization, stapling, Gatekeeper, entitlements, fuses, and size budgets. |
| `package-linux` | Build Linux packages + runtime verification on native runners. |
| `package-windows` | When enabled, build Authenticode-signed packages (or explicitly enabled unsigned beta). |
| `release-packages` | Collect artifacts, generate `SHA256SUMS.txt`, attest provenance, publish GitHub Release. |

Native release jobs pass `--skip-verify` only to skip re-running upstream `quality`/`hermetic-e2e`; bundle creation and post-package verification still run.
