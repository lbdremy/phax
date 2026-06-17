# Vocabulary review — terms a new user has to absorb

A pre-1.0 pass over the words phax puts in front of users (README, CLI output, docs). Goal:
spot terms that are ambiguous, overloaded, or assume internal knowledge, and propose clearer
framing. Nothing here changes behavior — it's about how we *name* and *explain* things.

Legend: 🟢 keep as-is · 🟡 keep the term but explain it on first use · 🔴 consider renaming.

---

## Core workflow nouns

### `phase` 🟢
**Means:** one isolated, gated, committed chunk of work — the atomic unit of a run.
**Risk:** low. It's the central concept and it's intuitive.
**Suggestion:** keep. Just make sure the *very first* mention (README opening, `--help`)
defines it in one sentence: "a phase is one focused chunk of work that gets its own branch,
its own checks, and its own commit." Everything else hangs off this.

### `run` vs `phase` 🟡
**Means:** a `run` is the whole execution of a plan; it contains many `phases`.
**Risk:** medium. "Run" is both a noun (the thing) and a verb (`phax run`). New users
conflate "a run" with "a phase" early on.
**Suggestion:** keep the words, but in docs always pair them once: "A **run** executes a
plan as a sequence of **phases**." Avoid sentences where "run" could be read as the verb.

### `plan.md` vs `phax-plan.json` 🟡
**Means:** `plan.md` is the human-authored Markdown; `phax-plan.json` is the validated,
machine-consumed extraction.
**Risk:** medium. Two artifacts, similar names, and `extract-plan` sits between them. Users
ask "which file do I edit?"
**Suggestion:** consistently call `plan.md` the **plan** (what you write) and
`phax-plan.json` the **compiled plan** or **extracted plan** (what phax runs). Never just
"the plan" when both are in scope.

### `extract-plan` 🟡
**Means:** the command that turns `plan.md` into `phax-plan.json` via the extraction agent.
**Risk:** medium. "Extract" undersells it — it validates against a JSON Schema and writes
atomically; it's really a *compile* step.
**Suggestion:** the term is fine if the help text frames it as "compile your plan.md into a
validated phax-plan.json." Consider `compile-plan` as an alias if you ever revisit naming.

### `handoff` (`phase-handoff.md`, `review-handoff.md`) 🟡
**Means:** the structured note a phase writes for the *next* phase; `review-handoff.md` is
the note written for the *human* at the end.
**Risk:** medium. One word, two audiences (agent-to-agent vs agent-to-human).
**Suggestion:** keep `handoff`, but in prose distinguish "phase handoff" (passed forward
between phases) from "review handoff" (the pointer to what *you* should review). A one-liner
in the README disambiguates them.

### `reconciliation` (`file-reconciliation.*`, `global-file-reconciliation.*`) 🔴
**Means:** comparing files the agent *actually* touched (real Git diff) against files the plan
*said* it would touch, deterministically bucketing them (as-planned / planned-but-missing /
unplanned / deletions / renames). The `review-handoff.md` then pairs this deterministic diff
with the agent's own `phase-handoff.md` narrative, per phase, into one review document.
**Risk:** high. "Reconciliation" is bank/accounting vocabulary; nobody guesses what it does
here. It's also one of phax's more useful features, so an opaque name actively *undersells*
it. The `report_only` / `warn` modes compound the opacity.
**Suggestion:** explain it everywhere in plain terms first — "**plan-vs-actual file check**:
did the phase touch the files it said it would, and if not, why?" Keep the technical name in
filenames if you like, but lead with the plain description (and the why-it-matters: it turns a
raw diff into a reviewable "planned vs actual, with the agent's reasons"). Note for users that
quality depends on the planned-file lists, which the **planning skill** is there to get right.

---

## Gating & verification

### `gate` / `gate profile` 🟡
**Means:** the verification commands run after a phase; a *profile* is a named set of them
(`fast`, `full`).
**Risk:** medium. "Gate" as a verb/noun is jargon, though common in CI circles. "Profile" is
fine once you've seen one.
**Suggestion:** keep. First-use gloss: "a **gate** is the set of checks a phase must pass —
your tests, typecheck, linter — before phax moves on." That single sentence does most of the
work.

### `fix loop` / `maxFixAttempts` 🟢
**Means:** on gate failure, resume the same session to fix and re-run, up to N times.
**Risk:** low. Self-explanatory once gates are understood.
**Suggestion:** keep.

---

## Routing vocabulary (the densest area)

### `model family` 🟡
**Means:** a stable grouping (`claude-sonnet`, `claude-opus`, `openai-gpt`…) that abstracts
over versioned model IDs.
**Risk:** medium. Reasonable term, but stacked next to "tier" and "effort" it's a lot at once.
**Suggestion:** keep. Anchor it with the *why*: "families exist so your plan doesn't rot
when a model ID changes."

### `tier` (`standard`, `strong`, `frontier-high`…) 🟡
**Means:** a provider-independent capability level; routing maps a tier to each provider's
best matching offering.
**Risk:** medium. The `frontier-*` ladder (`frontier-low/medium/high/xhigh/max/ultra`) is a
lot of rungs to hold in your head.
**Suggestion:** keep tiers — they're the right abstraction — but in user docs lead with three
mental anchors (`standard` = everyday, `strong` = harder work, `frontier-*` = the big models)
and treat the full ladder as reference, not front-page material.

### `effort` / `thinking level` 🔴
**Means:** the reasoning/thinking axis (`low | medium | high | max | xhigh | ultracode`…).
**Risk:** high. Two names for one concept (`EffortLevel` is aliased to `ThinkingLevel`), and
the value set is a superset where only some values are valid per family. `ultracode` and
`xhigh` aren't self-explanatory.
**Suggestion:** pick **one** user-facing word — recommend "effort" — and never show
"thinking level" in user-facing text. Document the valid values *per family* (the model-
routing doc already does this well); don't expose the raw superset to users.

### `provider priority` 🟢
**Means:** the ordered list phax tries when picking a provider.
**Risk:** low. Clear.
**Suggestion:** keep.

### `relationship` (`equivalent` / `downgrade`) 🟡
**Means:** whether a provider's offering for a tier matches the reference or is a step down.
**Risk:** medium. Internal-sounding; surfaces in routing output.
**Suggestion:** keep in the routing table, but in user-facing summaries phrase as
"**matched**" vs "**downgraded**" rather than the bare relationship name.

---

## Run identity (new in 1.0)

### `short name` / `qualified name` / `namespace` 🟡
**Means:** `fixbug` is the short name; `louloupapers` is the project namespace;
`louloupapers.fixbug` is the qualified name.
**Risk:** medium — but mostly *transitional*, since 1.0 introduces it. Three terms for one
identity.
**Suggestion:** the spec already nails the rule — say it once, prominently: "you *type* the
short name inside a project; phax *shows* you the qualified `namespace.shortname`
everywhere." Lead with that sentence wherever run identity first appears.

### `locked agent binding` 🟡
**Means:** the frozen (provider, model, session) recorded when a phase launches, used for all
later interaction with that phase.
**Risk:** medium. "Binding" is implementation vocabulary; users mostly need the *guarantee*,
not the data structure.
**Suggestion:** in user-facing text, lead with the promise — "once a phase starts, its model
and provider are locked; re-entering or resuming always uses that exact agent, never the
router." Reserve "binding" for internal/debug output (`phax session`).

---

## State & lifecycle

### `review_open` 🟡
**Means:** the run state where the final phase is finished but kept open for human review.
**Risk:** medium. Appears in `phax ls --review-open` and status output; the snake_case leaks
the internal state name.
**Suggestion:** keep the flag, but render the *display* form as "review open" or "awaiting
review" in human output. Reserve `review_open` for `--json`.

### `worktree` 🟡
**Means:** a Git worktree — a checked-out branch in its own directory, where a phase runs.
**Risk:** medium. Real Git term, but many users have never used `git worktree`.
**Suggestion:** keep (it *is* the Git concept), but gloss on first use: "each phase runs in
its own **Git worktree** — a separate working directory on its own branch, so your actual
checkout is never touched."

### `lock` / `unlock` / stale lock 🟢
**Means:** per-run lock file preventing concurrent execution.
**Risk:** low. Conventional.
**Suggestion:** keep.

### `publish` / `publish-pr` 🟡
**Means:** push the final phase branch and open a GitHub PR whose body is the review handoff;
runs automatically at end of run when `publish.enabled`, or manually via `phax publish-pr`.
**Risk:** medium. "Publish" is generic; users may not guess it means "push branch + open PR
with the review document as the description." The auto-vs-manual duality needs one sentence.
**Suggestion:** keep, but always describe the *payoff* on first use: "**publish** turns the
finished run into a GitHub PR whose description already contains the plan-vs-actual review —
automatically at the end of a run, or on demand with `phax publish-pr`."

### `archive` 🟢
**Means:** move a finished run's state and worktrees aside (non-destructive), then prune Git
admin records.
**Risk:** low — *as long as* we keep stressing "moves, never deletes." That property is the
reassuring part; don't bury it.
**Suggestion:** keep, and keep saying "nothing is deleted."

---

## The name itself

### `phax` 🟢 / 🟡
**Means:** the product. Reads as "ph(ase) + ax"? "fax"? It's not obvious how to say it or
what it's short for.
**Risk:** low functionally, but a one-line "what's in a name" (phases + ?) in the README
would help adoption and word-of-mouth ("how do you even say it?").
**Suggestion:** add a single sentence somewhere on origin/pronunciation. Cheap, friendly,
removes a small barrier.

---

## Top fixes, ranked

1. **`reconciliation` → lead with "plan-vs-actual file check"** in all user-facing text. The
   most opaque term for the least-obvious-but-useful feature.
2. **Collapse `effort` / `thinking level` to one word** (recommend "effort"), and stop
   exposing the raw superset of values to users.
3. **Say the namespace rule once, prominently:** type the short name, see the qualified name.
4. **Render internal state names** (`review_open`, `relationship`) in human form for human
   output; keep snake_case for `--json` only.
5. **One-sentence first-use glosses** for `phase`, `gate`, `worktree`, `run`-vs-`phase`. Most
   of the confusion evaporates with five well-placed sentences.
