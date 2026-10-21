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

### 0.26.0

- **Plan sidecars gain `assignmentReason`, `mode` and `oracle`.** `modelReason` becomes `assignmentReason`, and every phase gains `mode` and `oracle`. Run `phax artifact migrate-documents` once in each repository with plans under `docs/`. It renames the key, writes `mode: "headless"` and `oracle: null` on every phase, rewrites `**Model reason:**` lines as `**Assignment reason:**`, and commits the result. Until then, `phax artifact approve`, `reopen` and `decide` refuse and name the command.
- **Hand-written plans.** Rename each `**Model reason:**` line to `**Assignment reason:**`. `phax plans lint` reports the old label as an error, and `phax run` and `phax resume` refuse it with exit 11.
- **Runs in flight.** A run started by an older phax keeps a `phax-plan.json` in the older shape, which this phax refuses to resume. Finish the run before upgrading, or archive it with `phax archive <run> --force` and run its plan again.
- **New `models` warnings in `phax plans lint`.** Nothing to do. Lint now compares every phase with the policy default (`claude-sonnet-5-5` at `medium`) where no assignment bound governs it, so a phase at another model or effort with no `**Assignment reason:**` line gets a warning. Warnings never fail lint or refuse a run. Add a reason line to silence one, or declare [assignment bounds](assignment-bounds.md).

### 0.25.0

- **Spec and plan sidecars move to their current shapes.** Run `phax artifact migrate-documents` once in each repository with specs or plans under `docs/`. It rewrites every live sidecar below its current shape and commits the result. Until then, `phax artifact approve`, `reopen` and `decide` refuse and name the command.
- **Cost ledgers for older runs.** Nothing to do. `phax plans estimate`, the only reader of cost ledgers, writes one for every kept run that has none before it estimates. `phax cost backfill` does the same by hand.

### 0.19.0

- **Approval ledgers become one record file per artifact.** Run `phax artifact migrate-approvals` once on a clean tree in each repository that still has `docs/plans/approvals.json` or `docs/specs/approvals.json`. It commits the split by itself. Until then, approve, `plans status`, `artifact status` and `phax run` refuse with exit 12 and name the command.
