# Upgrading phax

Upgrade the way you installed phax:

```bash
npm install -g @lbdremy/phax@latest
```

With a downloaded binary, download the new release from [GitHub Releases](https://github.com/lbdremy/phax/releases) and replace the old one.

## After every upgrade

Two commands keep what phax copied into your repository in step with the new binary. Run both in each repository that uses phax, and commit what they change:

```bash
phax skills install --target claude   # the bundled skills (phax-planning, phax-spec, …); or codex, or agent
phax schema upgrade                   # phax.schema.json, the editor schema of phax.json
```

## Release by release

Only the releases that ask for something are listed. phax never asks for a step silently: a command that needs one refuses with exit 12 and names it.

### 0.30.0

- **Mistral Vibe 3.0.3 or later is required.** Run `uv tool upgrade mistral-vibe`. phax checks `vibe --version` before its first Vibe session and refuses an older Vibe, naming the installed version.
- **phax no longer reads `~/.vibe`.** A Vibe turn's answer, session id, usage and transcript come from its stream and from the `export.json` Vibe writes beside it. `VIBE_HOME` is no longer a provider store root. `phax agent setup mistral-vibe --install-model-aliases` still appends the phax aliases to your Vibe config.
- **Secure mode runs Vibe.** It is recorded as filesystem jail `strong`, with command enforcement `prefix`, so a `secure` run no longer falls back to Claude Code. Your own `config.toml` allowlists never reach a secure phax session.
- **Records.** Vibe usage is `{ provider, inputTokens, cachedInputTokens, outputTokens, costUsd }`. Older records still read; an older `@lbdremy/phax-schemas` cannot read 0.30.0 records.

### 0.28.0

- **A spec or plan option named `other`.** `other` is now a reserved id, implicit on every question. A live spec or plan that lists an option, or a recommendation, with the id `other` is refused: an authored answer exits 5, `phax artifact approve` and `decide` on the artifact exit 12, and `phax artifact status` reports a §9 that does not parse. Rename that option (in the sidecar and in the Markdown alike) before upgrading. A `Decision: other — …` line, and a verdict that chooses `other`, are accepted.
- **Plan sidecars: `testStrategy` becomes a list of test lines.** Run `phax artifact migrate-documents` once in each repository with plans under `docs/`. A sidecar whose every test strategy follows the line format is lifted and committed. One holding prose is refused, naming the phase and the line: rewrite it in the line format in the sidecar and in plan.md alike, or re-author the plan, then run the command again. Until then, `phax artifact approve`, `reopen` and `decide` refuse and name the command. Archived plans are not touched and still read.
- **Hand-written plans.** Write each `### Test strategy` entry in the line format: `<guarantee> — <size> · <technique> · <oracle> · <loop>[ · <criterion>]`. `phax plans lint` reports a departing line as a `tests` error. `phax run`, `phax plans overlap`, `phax adjust-plan` and `phax plans status` refuse such a plan before any model call, naming the line and `phax plans lint`, and `phax plans overview` exits 1. A phase with no section, or with `- (none)`, has no line.
- **Runs in flight.** A `phax-plan.json` extracted by an older phax is refused by `phax resume` and `phax validate --plan`. Finish the run with the release that started it, or archive it with `phax archive <run> --force` and run its plan again. `phax ls` and `phax session-info` still show it.
- **New `tests` warnings in `phax plans lint`.** Nothing to do. An uncovered acceptance criterion, or a source spec without a readable sidecar, is a warning that never fails lint or refuses a run.

### 0.27.0

- **Spec sidecars gain a `summary` on every surface element.** Run `phax artifact migrate-documents` once. It restamps every live spec sidecar, writes a placeholder summary on each element, re-renders §6 and commits; the report counts the summaries left to write per spec. Then write each summary, one sentence in the consumer's words, in the sidecar and on its §6 `Summary:` line. `phax artifact approve` and `complete` refuse (exit 12) a spec until its placeholders are gone, and `approve`, `reopen` and `decide` refuse until the migration has run. Archived specs are not touched.
- **Hand-authored specs:** add a `Summary:` line under each §6 element heading if you want the same layout; phax does not check it.
- **A run whose plan lists an oracle file twice.** `phax plans lint` and `phax run` now refuse a path repeated on an `**Oracle files:**` line, and so does `phax resume` (exit 11, "Oracle preflight failed") for a run an older phax started from such a plan. The refusal names the run's copy of the plan, `~/.phax/runs/<namespace>.<name>/plan.md`: remove the repeated path there, check it with `phax plans lint` on that file, and resume. Or archive the run with `phax archive <run> --force` and run the fixed plan again.
- **A phase an older phax left `committed`.** Nothing to do. Before 0.27, `phax resume` went past a phase interrupted between its handoff and its cleanup, or cut short in its handoff turn, and left it `committed` while later phases ran. phax 0.27 finishes such a phase only when it is the run's last started phase; one with later phases on disk stays as it is, without its record or cleanup, and its worktree stays until the run is archived.

### 0.26.0

- **Oracle phases** need an `oracles` provider: `phax plans lint` and `phax run` refuse an oracle phase without one. Nothing to run; phase records written earlier read with no oracle role.
- **Plan sidecars gain `assignmentReason`, `mode` and `oracle`.** `modelReason` becomes `assignmentReason`, and every phase gains `mode` and `oracle`. Run `phax artifact migrate-documents` once in each repository with plans under `docs/`. It renames the key, writes `mode: "headless"` and `oracle: null` on every phase, rewrites `**Model reason:**` lines as `**Assignment reason:**`, and commits the result. Until then, `phax artifact approve`, `reopen` and `decide` refuse and name the command.
- **Hand-written plans.** Rename each `**Model reason:**` line to `**Assignment reason:**`. `phax plans lint` reports the old label as an error, and `phax run` and `phax resume` refuse it with exit 11.
- **Runs in flight.** A run started by an older phax keeps a `phax-plan.json` in the older shape, which this phax refuses to resume. Finish the run before upgrading, or archive it with `phax archive <run> --force` and run its plan again.
- **`run-status.json` gains a required `hold`.** Scripts that read it find `{ selection: none }` on every run not started with `--hold`, and runs written by older releases read as `none`. Nothing to run.
- **New `models` warnings in `phax plans lint`.** Nothing to do. Lint now compares every phase with the policy default (`claude-sonnet-5-5` at `medium`) where no assignment bound governs it, so a phase at another model or effort with no `**Assignment reason:**` line gets a warning. Warnings never fail lint or refuse a run. Add a reason line to silence one, or declare [assignment bounds](assignment-bounds.md).

- **`phax ls --json` prints a run list.** The bare array becomes one `run-list` document: read `.runs[]` instead of `.[]`. `currentPhase`, `gateProfile`, `recordsPending` and `archivePath` are null when unknown, where they used to be dropped or printed as `-`, and every run carries `stop`, its review-stop document or null. Nothing to run.
- **The record manifest gains `mode` and `stop`.** Records written by released phax read as headless phases that never stopped. Records written by 0.26.0 development builds before this change no longer read: `phax records explain` on a commit of such a run fails and names the malformed manifest, and `phax records list` skips the record.
- **`security.json` moves to version 2.** It gains a required `stop`. A version-1 file reads as a phase that never stopped; a close rewrites it as version 2. A run started by a 0.26.0 development build with a closed stop or an `interactive-session.json` does not resume.
- **Closing a stop needs a git identity** (`user.name` and `user.email`) in the main checkout; a close without one is refused with exit 1.

None of these four changes needs a command.

### 0.25.0

- **Spec and plan sidecars move to their current shapes.** Run `phax artifact migrate-documents` once in each repository with specs or plans under `docs/`. It rewrites every live sidecar below its current shape and commits the result. Until then, `phax artifact approve`, `reopen` and `decide` refuse and name the command.
- **Cost ledgers for older runs.** Nothing to do. `phax plans estimate`, the only reader of cost ledgers, writes one for every kept run that has none before it estimates. `phax cost backfill` does the same by hand.

### 0.19.0

- **Approval ledgers become one record file per artifact.** Run `phax artifact migrate-approvals` once on a clean tree in each repository that still has `docs/plans/approvals.json` or `docs/specs/approvals.json`. It commits the split by itself. Until then, approve, `plans status`, `artifact status` and `phax run` refuse with exit 12 and name the command.
