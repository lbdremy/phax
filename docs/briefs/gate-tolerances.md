Write the phax spec `gate-tolerances`: a project can declare a command phax runs between a phase's commit and its
gate, the one thing in a run allowed to write the protected files that record what the gate tolerates. It tightens
them on its own, and loosens them only by what the approved plan declared for that phase. Each of its writes is a
commit of its own, and the gate judges the result.

## Why

Some gates read a file that says what they tolerate: a baseline of failures accepted as debt, a ratchet's value (a
count that may only go down, a coverage that may only go up). Such a file is the operator's, so projects put it in
`protectedPaths`, and no phase may change it. Two changes a run needs then have no route inside it:

- **A phase pays what was tolerated.** The tolerance is now stale: a baseline holds an entry nothing uses, a ratchet
  could be tighter. A gate that checks the file is exact fails, and only the operator can fix it, by hand, before or
  in the middle of the run.
- **A phase introduces what makes existing code fail.** A new rule, or a stricter one, fails on code the run did not
  write. The intent is to accept those failures as debt and pay them later. The phase's gate is red by design, and
  the run reaches its pull request only if the operator carries it past a red gate and edits the file on the run's
  branch afterwards.

Both came up again on 2026-11-18, on a plan whose last phase applies new rules to a codebase: its plan had to name a
phase "red by design", the steps and tests that would fail, and a hand step of the operator's after the run. The
same shape had come up before with ratchets.

What the operator wants is not a way around the protection. It is that the acceptance be decided where their
attention already is, when they approve the plan, and applied by something that cannot accept more than was approved.

## What phax has today, to read first

- `docs/security.md`, "Protected paths"; the archived brief `docs/briefs/archive/protected-paths.md`.
- The brief `docs/briefs/protected-path-exceptions.md`: the operator grants one phase, at its resume, the change of
  protected paths it names. Its direction says a plan cannot grant itself an exception, and neither can an agent.
  This brief must hold that line: here no agent writes a protected file and no plan grants a path; a command the
  operator configured writes, bounded by a declaration the operator approved.
- Expected-failure markers (the `oracle-phases` specs, `docs/acceptance-phases.md`): a test written before its
  feature is declared failing in the code and passes the gate. The kinship is "this red is foreseen and bounded";
  the difference is where it is said. A marker is written by a phase, in the code, and shows in the diff. A
  tolerance is the operator's file, which no phase writes.
- Where the protected-path check runs (`src/app/protectedPathsCheck.ts`, each gate attempt in `src/app/fixLoop.ts`),
  and how a plan's phase carries declared data to a run (the plan document's schema, the extracted plan).
- How gates and their steps are declared in `phax.json`, and how a gate provider's report is read.

## The direction (the operator's, 2026-11-18)

1. **One step, declared by the project.** `phax.json` names a command and the protected paths it alone may write.
   phax runs it after the phase's work is committed and before the gate. Nothing else in a run writes those paths:
   the check on the phase's own changes stays as it is.
2. **Two moves, of very different risk.**
   - *Tighten*: remove what is no longer needed (a paid debt, a ratchet moved in its strict direction). Needs no
     declaration. It can only make the gate stricter.
   - *Loosen*: accept a failure. Only what the plan declared for that phase, and the plan is approved by the
     operator. Anything the command would accept beyond the declaration is refused, and the gate stays red.
3. **The plan carries the declaration, phax does not read it.** A phase of the plan may hold an entry for this step:
   data whose meaning is the command's (rule identifiers, a scope). phax hands it over as written. It shows in the
   plan the operator approves, and `phax plans lint` shows which phases carry one.
4. **Bounded by what the run touched.** The step is told the files the run has changed since its base. The intended
   rule, which the command applies and reports: a failure is accepted only in a file the run did not change. Code a
   run writes must pass; only code that was there before a rule may owe it. phax checks what it can itself: the
   command wrote no path but the declared ones, and none of the files it says it accepted a failure in is one the
   run changed.
5. **Before the gate, and its own commits.** The gate judges the final tree, the tolerance files included, so no
   commit lands after it unjudged. A tightening and a loosening are each a commit of their own, apart from the
   phase's, with a trailer naming the step and, for a loosening, the plan's declaration it applied.
6. **Recorded.** The phase's records say what the step wrote, under which declaration, and what it refused.

## What the spec must cover

- **The surface**: the `phax.json` key (the command, its paths, when it runs), the plan's entry per phase and its
  place in the plan document's schema, the command's contract (what it receives: the phase, the declaration, the
  changed files; what it answers: files written, files it accepted failures in, what it refused), and the commits'
  subjects and trailers.
- **Refusals**: a command that writes a path it did not declare; a declared path that is not protected; a loosening
  with no declaration; an accepted failure in a file the run changed; a command that fails. Each with what the
  operator sees and how the run resumes.
- **The fix loop**: the step runs again after each fix attempt, or once; whether a tightening made before a failed
  gate is kept.
- **Resume, hold and reset**: what a commit-only resume, a held phase and `phax reset-phase` do with the step's
  commits.
- **Providers**: the step is a command of the project's, not an agent's turn. Say how the phase's posture names it
  and that no provider's native rules are loosened for it.
- **The limit to state**: a failure can appear in a file the run did not change because of one it did (a file moved,
  so an old import now reaches a forbidden place). It is accepted if its rule is declared. The spec says so, and
  what the record shows of it.
- **Its relation to `protected-path-exceptions`**: both are routes to a wanted change of a protected path; one is the
  operator's act at a resume, for any path; this one is declared before the run, for tolerance files only, through a
  command. They must not become two ways to do the same thing.

## Out of scope

- What a debt, a baseline or a ratchet is: the command's matter. phax knows files, a declaration it does not read,
  and commits.
- A mode in which a new rule is reported without failing: that is a gate provider's feature, if it wants one.
- An acceptance that expires, by date or by commit.
- Letting an agent choose what is tolerated.

## Open, for the spec's questions

- Whether the tightening needs any plan entry at all, or runs in every phase of a project that declares the step.
- Whether a declaration may be given at `phax resume` too, when a run meets a failure no plan foresaw, or whether
  that is always `protected-path-exceptions`.
- One commit per move, or one per file written.
- Whether a history that must be green commit by commit is a need: the phase's own commit, taken alone, is red.
