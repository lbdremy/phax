Write the phax spec `roadmap-items`: a brief becomes an artifact with a status and a rank, and the ordered briefs
are the project's roadmap. phax lists it, a person or an agent votes on an item with the evidence of what it cost
them, and the operator ranks. `NEXT_STEPS.md`'s queue moves into it.

## Why

The operator, 2026-11-22. phax tracks every step of a change but the first: a spec, a plan, a run, its review and its
pull request each have a status and a record, while the idea they came from is a section of `NEXT_STEPS.md`, 759
lines of free text ranked and ticked by hand. Most of its queue items (§1 to §18) already point to a brief under
`docs/briefs/`, and `phax artifact new spec --brief` already starts a spec from one. The brief is the roadmap item in
all but name.

Whether an item matters is also a fact phax can hold. `docs/briefs/protected-path-exceptions.md` records two runs
that rewrote a phase's `base` by hand to get past a protected path (a held run of 2026-11-11 at its eighth phase,
`bounded-test-spawns` at its tenth). That is a better reason to rank it than a wish, and today it lives as prose. An
agent that hits the same wall has no way to say so but to tell the operator in a conversation that ends.

The roadmap is also how phax shows verified delegation (`docs/briefs/positioning.md`): an agent's vote carries the
run that showed the need, as its "done" carries the gate that passed.

## The direction (the operator's, 2026-11-22)

1. **The brief is the item.** A brief under `docs/briefs/` gains a frontmatter: its status, its rank, the spec it
   became. No second file per idea. A small item gets a brief of a few lines.
2. **A vote carries evidence.** A vote names what it rests on: a run and a phase, what blocked it, the way round it
   took. A person may also vote with a note alone. An agent's vote with no evidence is refused: agents would vote
   for whatever they are shown, and the count would say nothing.
3. **Votes live in the repository.** `phax roadmap vote` writes to the records branch `phax/records/v1`, like the
   other records: offline, versioned, available to an agent through the command line. Votes from people outside the
   team come later, if at all.
4. **The operator ranks.** Votes inform the order; they never set it. Ranking is the operator's act, like approving
   a spec.
5. **The site shows it.** phax's own roadmap is a page of `docs.phax.run`, generated from the briefs and their votes
   like the rest of the site.

## What phax has today, to read first

- `NEXT_STEPS.md`: the queue (§1 to §18) and the sections that are not queue items (model policy tracking, the road
  to 1.0, steme coordination, small follow-ups, spec candidates, the longer horizon).
- `docs/briefs/` and `docs/briefs/archive/`: the live briefs and the landed ones; `phax artifact new spec --brief`.
- The artifact lifecycle (`phax artifact status`, `approve`, the statuses `Draft`, `Approved`, `Stale`, `Abandoned`,
  `Completed`), the frontmatter of specs and plans, and the spec chain gates.
- The records branch and its record kinds (`phax records explain`); `phax finding` and its fates, the closest thing
  phax has to a vote with evidence.
- `docs/briefs/inbox.md` (what waits and on whom) and `docs/briefs/knowledge-index.md` (the local index), which
  would both read the roadmap.
- `site/pages.ts` and `site/build/`: how a page is generated from repository files.

## What the spec must cover

- The brief's frontmatter: its statuses and their transitions (to weigh: `Idea`, `Queued`, `Specced`, `Landed`,
  `Dropped`), its rank, its link to the spec, and how a brief reaches `Landed` (when its spec completes, or its last
  plan's run lands).
- The commands: listing the roadmap (`--json`, ordered by rank, with votes and evidence), voting, ranking, and who
  may run each (ranking is the operator's, as `artifact approve` is).
- The vote record: its fields, the evidence it may name (a run, a phase, a finding, a gate attempt) and how phax
  checks that the named run exists, its version, and one vote per voter per item or several.
- Who a voter is: a person (the Git identity) or an agent (`machine:<provider>`, as `phax finding fix --by` names
  it).
- The migration of `NEXT_STEPS.md`: which sections become briefs, which stay notes and where, and whether the file
  goes.
- The site page: what it shows (rank, status, votes, evidence, the spec and pull request once there) and that it
  holds nothing the repository does not.

## Out of scope

- Votes from outside the repository (GitHub reactions, a shared service).
- Ranking from votes automatically.
- The positioning itself (`docs/briefs/positioning.md`).

## Constraints

- Additive: a project with no briefs, or briefs with no frontmatter, sees no change in behaviour or output.
- Keep the spec short, with only genuine §9 questions, each with its options, what each abandons and a recommended
  default.

Output: your final message is the spec document JSON and nothing else — no sentence before or after it, no code fence.
