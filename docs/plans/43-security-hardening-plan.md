# Plan 43 — Security-audit follow-ups (defense-in-depth hardening)

## Overview

The security audit in PR #65 fixed the one HIGH exposure (the npm installer now
verifies the release binary's SHA-256 before executing it) and confirmed a
strong baseline. It also left three LOW / defense-in-depth items that this plan
closes. They are independent, mechanical changes; each is its own committable
phase.

1. **Git argument injection (defense-in-depth).** `src/infra/git.ts` runs git via
   `execFile` with an argv array, so there is no shell-injection surface. But no
   command separates options from operands with `--`, and `BranchNameSchema`
   (`src/domain/branded.ts`) only enforces `minLength(1)` — it accepts a value
   like `--upload-pack=…` or one with whitespace/control characters. A branch or
   ref value beginning with `-` would be parsed by git as a flag (argument
   injection). Branch names are currently derived from strict `Namespace` /
   `ShortName` slugs, so this is not reachable today; the phase hardens the
   boundary so it stays unreachable if a future call site feeds less-constrained
   input.

2. **Interpolated `execSync` in a dev script.** `scripts/docs-cli.ts:73` builds a
   shell command by string interpolation. Both interpolated values derive from
   `import.meta.url` + literal filenames (no external input) and the script is
   dev-only, so it is not exploitable — but converting it to `execFileSync` with
   an argv array removes the pattern and the static-analysis flag.

3. **Unpinned GitHub Actions.** `.github/workflows/ci.yml` and `release.yml` pin
   third-party actions to mutable major tags (`@v4`, `@v2`). A compromised
   upstream tag would silently re-point CI (and the release job, which holds
   `contents: write` and `id-token: write`). Pinning to full commit SHAs removes
   that mutable-supply-chain link.

No schema-persistence changes, no new dependencies, and no new provider or
routing behavior are involved. The audit toolkit added in PR #65
(`pnpm audit:security`) can confirm the outcomes: the `code` check stops flagging
the git adapter and `docs-cli.ts`, and the `release` check stops flagging
tag-pinned actions.

## Required commands

- (none)

All three phases only edit existing source and configuration files and are
verified by the already-configured gate profiles. No new tool, runtime, or CLI
is introduced.

## phase-01 — Harden the git adapter against argument injection {#phase-01-git-arg-injection}

**Recommended model:** claude-sonnet-5
**Recommended effort:** medium

Tighten `BranchNameSchema` so a branch/ref value can never be mistaken for a git
option, and add `--` option/operand separators in the git adapter where git
supports them. Together these close the argument-injection margin the audit
flagged, without changing any observable behavior for valid branch names.

### Detailed instructions

- In `src/domain/branded.ts`, replace `BranchNameSchema`'s bare
  `Schema.minLength(1)` with a pattern that rejects the dangerous shapes while
  still accepting every valid git branch name the codebase already produces and
  parses:
  - Reject an empty string (keep current behavior).
  - Reject a leading `-` (the argument-injection vector).
  - Reject ASCII whitespace and control characters.
  - Continue to accept slashes and dots, e.g. `main` and `feature/my-thing`
    (these are asserted in `tests/unit/branded.test.ts` and are produced when
    `currentBranch` decodes `git rev-parse --abbrev-ref HEAD` output). Do **not**
    over-restrict to the slug charset — `decodeBranchName` also parses real repo
    branch names, not just phax-generated ones.
  - Keep `maxLength` reasonable (e.g. 255, git's ref-name limit) if you add one;
    do not lower it below what real branch names need.
- In `src/infra/git.ts`, insert `--` to separate options from positional
  refs/paths for the commands that accept it, so a value beginning with `-` is
  always treated as an operand:
  - `createBranch`: `git branch -- <branch> <from>`
  - `deleteBranch`: `git branch <-d|-D> -- <name>`
  - `branchExists`: `git rev-parse --verify --quiet -- <branch>` (verify git
    accepts `--` here; if a specific subcommand does not, rely on the schema and
    note it in the handoff rather than emitting a broken argv).
  - `addWorktree` / `removeWorktree`: place `--` before the positional
    `<path>`/`<branch>` operands per `git worktree`'s documented synopsis.
  - `pushBranch`: `git push --set-upstream <remote> -- <branch>` if supported;
    otherwise leave and document.
  - Do not add `--` to commands whose args are all fixed literals (`status
    --porcelain`, `add -A`, `commit -m … -m …`, `diff --name-status HEAD^ HEAD`,
    `worktree prune`) — there is no operand to protect.
- Verify each `--` placement against git's actual synopsis before committing; a
  misplaced `--` that breaks a command must fail the gate's tests, so exercise
  the changed commands.

### Planned files to create

- (none)

### Planned files to edit

- `src/domain/branded.ts`
- `src/infra/git.ts`
- `tests/unit/branded.test.ts`

### Optional files that may be edited

- `tests/integration/perPhaseBranch.test.ts`

### Boundary contracts

`BranchNameSchema` (producer: `src/domain/branded.ts`) is consumed by the git
adapter (`src/infra/git.ts`, via `decodeBranchName`) and by the app layer
(`resolveRunInfo.ts`, `resetPhase.ts`, `worktree.ts`, `executePlan.ts`). The
stable contract: the decoder must keep accepting every branch name those callers
legitimately construct or read back from git (`main`, `feature/my-thing`, phax's
generated per-phase branch names) while rejecting empty, leading-`-`, and
whitespace/control-character inputs. Do not change the `BranchName` brand's type
or the decoder's signature.

### Test strategy

- Domain: extend `tests/unit/branded.test.ts` `describe("decodeBranchName")`
  before implementation — assert acceptance of `main` and `feature/my-thing`
  (regression), and rejection of `""`, `"-x"`, `"--upload-pack=x"`, a
  leading-space name, and a name containing a control/whitespace character.
- Adapter: the `full` gate's integration tests exercise the git adapter; ensure
  the `--` additions keep `git branch` / `git worktree` calls working. Add or
  adjust an integration assertion only if `perPhaseBranch.test.ts` does not
  already cover the changed call sites.

### Implementation order

Schema first (`branded.ts` + its unit tests), then the adapter `--` separators,
then run the gate to confirm no branch/worktree operation regressed.

### Excluded scope

- Tightening `WorktreePath`, `Namespace`, or `ShortName` schemas.
- Any change to how branch names are generated in the app layer.
- Adding a shell-based git path or changing the `execFile` invocation model.

### Verification

- The project's configured `full` gate profile in `phax.json`.
- Optional cross-check: `pnpm audit:security code` no longer emits the
  "git adapter never uses '--'" finding.

### Expected handoff content

- The final `BranchNameSchema` pattern and the exact list of git commands that
  received a `--` separator (and any command deliberately left unchanged because
  git does not accept `--` there, with the reason).
- Confirmation that `decodeBranchName` still accepts `main` and
  `feature/my-thing`.
- Any deviation from the planned file lists, with the reason.

### Commit subject

fix(git): reject option-like branch names and separate git operands with --

### Commit body

Tighten BranchNameSchema to reject empty, leading-dash, and whitespace/control
branch names, and add -- option/operand separators in the git adapter so a
ref/path value beginning with - can never be parsed as a git flag. Defense in
depth for the argument-injection margin flagged by the security audit; valid
branch names (main, feature/my-thing) are unaffected. Covered by unit tests in
branded.test.ts.

## phase-02 — Replace interpolated execSync in docs-cli with execFileSync {#phase-02-docs-cli-execfile}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Remove the string-interpolated shell command in the docs generator by invoking
the `usage` CLI through `execFileSync` with an argv array, matching how the rest
of the codebase spawns subprocesses.

### Detailed instructions

- In `scripts/docs-cli.ts`, replace the
  `execSync(`usage generate markdown -f "${specPath}" --out-file "${refPath}"`, …)`
  call with `execFileSync("usage", ["generate", "markdown", "-f", specPath,
  "--out-file", refPath], { stdio: "inherit" })`.
- Update the import from `execSync` to `execFileSync` (both from
  `node:child_process`).
- Behavior must be unchanged: it still writes `docs/cli/reference.md` from
  `phax.usage.kdl`. Do not alter the surrounding README-splicing logic.

### Planned files to create

- (none)

### Planned files to edit

- `scripts/docs-cli.ts`

### Optional files that may be edited

- (none)

### Boundary contracts

None — this is an internal dev script with no consumer beyond the `pnpm docs:cli`
npm script.

### Test strategy

- Page/CLI (dev script): there is no unit test for this generator. The `full`
  gate's `typecheck`, `lint`, and `knip` steps confirm the change compiles, uses
  the imported symbol, and leaves no dead import. Behavioral confirmation is that
  `docs/cli/reference.md` is unchanged when regenerated (the executing agent may
  note this in the handoff; it is not a gate step).

### Implementation order

Single edit; run the gate.

### Excluded scope

- Any change to `scripts/generate-usage-spec.ts` or other scripts using regex
  `.exec()` (those are not command execution and were not flagged).
- Changing the `usage` CLI arguments or the generated output.

### Verification

- The project's configured `full` gate profile in `phax.json`.
- Optional cross-check: `pnpm audit:security code` no longer emits the
  "Interpolated command string in exec()/execSync()" finding.

### Expected handoff content

- Confirmation that `execFileSync` replaces `execSync` and that regenerated
  `docs/cli/reference.md` is byte-identical to the committed version.
- Any deviation from the planned file lists, with the reason.

### Commit subject

refactor(scripts): invoke usage via execFileSync instead of interpolated execSync

### Commit body

Replace the string-interpolated execSync in docs-cli.ts with an execFileSync
argv-array call to the usage CLI, matching the codebase's subprocess convention
and clearing the static-analysis flag. Output is unchanged; the paths were
already static, so this is hygiene, not a live fix.

## phase-03 — Pin GitHub Actions to commit SHAs {#phase-03-pin-actions}

**Recommended model:** claude-sonnet-5
**Recommended effort:** low

Pin every third-party GitHub Action in both workflows to a full commit SHA with
a trailing version comment, removing the mutable-tag supply-chain link on CI and
the privileged release job.

### Detailed instructions

- In `.github/workflows/ci.yml` and `.github/workflows/release.yml`, replace each
  `uses: <action>@<tag>` with `uses: <action>@<sha> # <tag>` using the SHAs
  resolved at plan-authoring time:

  | Action | Tag | Commit SHA |
  | --- | --- | --- |
  | `actions/checkout` | v4 | `34e114876b0b11c390a56381ad16ebd13914f8d5` |
  | `actions/setup-node` | v4 | `49933ea5288caeca8642d1e84afbd3f7d6820020` |
  | `denoland/setup-deno` | v2 | `667a34cdef165d8d2b2e98dde39547c9daac7282` |
  | `pnpm/action-setup` | v4 | `b906affcce14559ad1aafd4ab0e942779e9f58b1` |
  | `softprops/action-gh-release` | v2 | `3bb12739c298aeb8a4eeaf626c5b8d85266b0e65` |

  Example: `uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4`.
- Keep the trailing `# <tag>` comment so a human (or Dependabot) can still track
  which version the SHA represents.
- Change only the `uses:` lines — do not modify step ordering, `with:` inputs,
  `env:`, `permissions:`, or job structure.
- Both workflows reference `actions/checkout@v4`, `actions/setup-node@v4`,
  `denoland/setup-deno@v2`, and `pnpm/action-setup@v4`; `release.yml` additionally
  uses `softprops/action-gh-release@v2`. Pin every occurrence in both files.

### Planned files to create

- (none)

### Planned files to edit

- `.github/workflows/ci.yml`
- `.github/workflows/release.yml`

### Optional files that may be edited

- (none)

### Boundary contracts

None — CI configuration only; no application code is touched.

### Test strategy

- CI/config: the `full` gate does **not** lint or execute GitHub workflows, so it
  passes trivially ("à vide") on this phase. That is honest for a
  workflow-only edit — there is no code surface to protect. The real verification
  is (a) the SHAs in the diff match the table above exactly, and (b) the next CI
  run on the PR still succeeds with the pinned actions. The executing agent
  cannot trigger CI from its worktree; treat correctness as confirmed by the
  SHA table plus the post-merge CI run.

### Implementation order

Edit `ci.yml`, then `release.yml`; diff each `uses:` line against the table.

### Excluded scope

- Reducing the release job's `contents: write` / `id-token: write` scopes (those
  are required for `action-gh-release` and npm provenance; the audit marked them
  INFO, not a finding).
- Adding Dependabot config or a workflow linter.
- Pinning the `usage` CLI download in the `Install usage CLI` step (separate
  concern; it is version-pinned via `USAGE_VERSION` already).

### Verification

- The project's configured `full` gate profile in `phax.json` (passes trivially;
  see Test strategy).
- Human/CI confirmation: every `uses:` SHA matches the table, and CI on the PR
  goes green with the pinned actions.

### Expected handoff content

- A table of each `uses:` line changed, its old tag, and the new SHA, so a
  reviewer can verify against the plan without re-resolving the SHAs.
- An explicit note that the gate passed trivially and CI is the real signal.
- Any deviation from the planned file lists, with the reason.

### Commit subject

ci: pin GitHub Actions to commit SHAs

### Commit body

Pin every third-party action in ci.yml and release.yml to a full commit SHA with
a trailing version comment, removing the mutable-tag supply-chain link on CI and
the privileged release job (contents: write, id-token: write). Addresses the
LOW finding from the security audit. No workflow behavior changes.
