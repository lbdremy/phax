# Next steps

Follow-up work identified on 2026-08-09 (mapping phax against data-engineering lessons —
graphs / ETL / change detection / democratization — and the desktop-app idea in
`docs/ideas/desktop-app.md`). Specs are written and Approved; nothing below is
implemented yet. Tick items off as they land, and delete this file when it is empty.

## Plan and run the approved specs

Planning order: 21 → 22 (22 consumes 21's state vocabulary); 23 and 24 are independent
and can go anytime after — 24 is the largest and consumes 21 + 22.

- [ ] `docs/specs/21-artifact-lifecycle-status.md` — spec/plan state machines; only an
      `Approved` plan runs; archive-location agreement; `phax artifact` commands.
- [ ] `docs/specs/22-plan-staleness-lineage.md` — approval binds plan + spec + repo
      baseline; staleness reasons `spec-changed | ground-changed | self-changed`; hard
      gate at run start; `phax plans status [--apply]`.
- [ ] `docs/specs/23-phase-decision-requests.md` — blocking agent-raised decision
      requests; answer-and-resume; decisions in the review handoff.
- [ ] `docs/specs/24-batch-execution-disjoint-plans.md` — parallel disjoint plans,
      incremental ordered merge, terminal gate on the integration result, published as
      GitHub stacked PRs (`gh stack`, public preview 2026-07-30) with a
      single-integration-PR fallback.

## Small follow-ups (no spec needed)

- [ ] Persist the orientation brief as a discrete artifact (`orient-brief.json` next to
      `prompt.md`) — one-phase plan amending the behavior of archived spec 17; today the
      brief exists only woven into `prompt.md` plus a telemetry count.
- [ ] Audit the remaining active specs (15, 16, 18, 19) — any that are implemented on
      `main` should be flipped `Archived` and moved to `docs/specs/archive/` (done for
      17 on 2026-08-09).
- [ ] Align path-rooting on the git convention (run from any subdirectory). Today the
      CLI implicitly assumes `cwd == repoRoot`: git operations are correctly rooted at
      `config.repoRoot`, but the `FileSystem` port resolves relative paths
      (`docs/plans/approvals.json`, spec files, routing config) against `process.cwd()`.
      The two disagree the moment you invoke phax from a subdirectory — e.g. the
      staleness gate's git side reads the real baseline while the approval-store read
      misses, reporting a spurious `missing-record` and refusing an approved run. git
      itself works from anywhere in the tree by resolving against the repo root; since
      phax is an extension of git and leans on it heavily, it should match that
      contract. Direction: root the `FileSystem` adapter at `repoRoot` (or resolve
      repo-relative paths through a single helper) so `run`, `artifact`, and `plans`
      behave identically regardless of the working directory. Surfaced during the
      phase-06 staleness-gate review.

## Spec candidates, deliberately not written yet

- [ ] Preview manifest — `phax.json` declares how to preview a finished run
      (per-project-type discriminated union: web / cli / lib). Write it when desktop
      work starts; nothing consumes it before then.
- [ ] Desktop app (review-by-trajectory cockpit) — stays in `docs/ideas/desktop-app.md`
      until specs 21–24 land: by its own rule the desktop only wraps existing CLI
      surface, so its spec would otherwise invent commands.

## Longer horizon (unspecced, revisit deliberately)

- [ ] Cross-run durable context layer — feed the orient provider from phax's own run
      history (handoffs, deviations, final reports) instead of leaving the archive a
      filing cabinet.
- [ ] Derived spec views — regenerate a readable spec from the E2E tests on demand (a
      computed report, never a maintained file).
- [ ] Raise-and-continue "assumption" variant for decision requests — excluded from
      spec 23 v1 on purpose; revisit only if real runs show over-blocking.
