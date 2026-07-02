# phax security-audit toolkit

Reusable, dependency-free security checks for the phax codebase and its release
artifacts. Every script degrades gracefully: it uses a professional scanner when
one is installed and falls back to built-in checks otherwise, so a fresh checkout
can always run the full audit with nothing but `bash`, `git`, and `pnpm`.

## Run it

```bash
# everything (deps + secrets + code + release)
pnpm audit:security
# or directly:
scripts/security/run-audit.sh

# a single check
scripts/security/run-audit.sh code
scripts/security/run-audit.sh deps secrets
```

Reports are written to `dist/security-audit/` (gitignored):

- `report.md` — human-readable, grouped by severity
- `findings.jsonl` — one JSON object per finding (for CI / diffing)
- per-tool raw output (`pnpm-audit.json`, `semgrep.json`, `gitleaks.json`, …)

Exit code: `0` clean (or low/info only), `1` when the `FAIL_ON` threshold is met.

## Checks

| Check     | Script             | What it looks for                                                                                                                                                      |
| --------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deps`    | `deps-audit.sh`    | pnpm advisory audit (prod), lockfile hygiene, optional osv-scanner/trivy + SBOM (syft/cdxgen)                                                                          |
| `secrets` | `secrets-scan.sh`  | gitleaks (working tree + optional history) or a built-in pattern scan; tracked credential files                                                                        |
| `code`    | `code-scan.sh`     | `shell:true`, interpolated `exec`/`execSync`, `eval`/`new Function`, side-effect imports leaking out of `src/infra`, git argv without `--`; optional semgrep deep pass |
| `release` | `release-audit.sh` | npm publish surface, installer checksum verification, release-binary SHA-256 sidecars, Actions pinning + token scope, provenance                                       |

## Environment

| Var             | Default               | Effect                                   |
| --------------- | --------------------- | ---------------------------------------- |
| `AUDIT_OUT_DIR` | `dist/security-audit` | Report directory                         |
| `FAIL_ON`       | `high`                | Exit-code gate: `high`, `med`, or `none` |
| `AUDIT_LEVEL`   | `high`                | pnpm audit threshold                     |
| `SCAN_HISTORY`  | `0`                   | `1` = also gitleaks the full git history |

## Optional upgrades (auto-detected)

```bash
brew install gitleaks semgrep osv-scanner syft   # deeper coverage when present
```

None are required; the toolkit reports which optional tools are missing and what
it fell back to.

## Auditing the release build

The `release` check verifies binaries once they exist. To audit an actual build:

```bash
pnpm deno:build-binaries          # writes dist/release/phax-* + .sha256
scripts/security/run-audit.sh release
```

It recomputes each binary's SHA-256 and compares it against the published
`.sha256` sidecar, so a tampered artifact fails the check.

## Wiring into CI

Add a job step that runs `scripts/security/run-audit.sh` with `FAIL_ON=high`
(the default). Install `gitleaks`/`semgrep`/`osv-scanner` in the runner first for
full-depth coverage.
