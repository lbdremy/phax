Write the phax spec `single-provider`: an operator can run all of phax's work on one provider (Mistral Vibe is the case
in hand) by configuration alone, and every job phax runs either honours that choice or refuses, saying why. No job
quietly runs on another provider.

## Why

The operator asked on 2026-11-24 whether moving everything to Mistral is only a matter of provider settings and
routing. It is not. An audit of `main` (2026-11-24) found that phase execution and most headless jobs can reach Vibe,
but only one model key at a time. Several jobs cannot reach it at all.

A second question sits under the first. Today's routing matches **levels**: a Claude model asked for, and a spoke model
of the same level. Only a provider of the same generation can be `equivalent`. Codex and Claude match that way; Mistral
Large 4, a generation below (`docs/briefs/mistral-large-4.md`), can only ever be a `downgrade`.

What the operator actually knows is about **tasks**: planning, the hardest task, ran well on Claude Opus 4.5. The model a
plan names is mostly a default, not a requirement. `PHASE_MODEL_POLICY` puts Sonnet 5.5 `medium` on every phase because it
is the right price in Claude's line-up. A task has a floor (the lowest level that does it well), and any provider above
that floor will do. `allowDowngrade` is the only tool near this today, and it is one global switch: it says nothing
about which task can take how far a drop.

## What phax has today (audit, 2026-11-24; file:line on `main`)

| Job | How the provider is chosen | Vibe today |
| --- | --- | --- |
| Phase execution, fix loop, handoff | Routed from the phase's model (`src/app/executePlan.ts:860-865`) | With config: Vibe enabled, phase names a Mistral id or one of the two anchored Claude ids |
| Headless authoring, revise | Routed; default `claude-opus-5-5` (`src/schemas/phaxConfig.ts:201`); `authoring.spec/plan.model` | With config |
| Code review (headless), compliance | Routed; defaults Opus 5.5 / Sonnet 5.5 (`phaxConfig.ts:357`, `:252`); `review.code.model`, `review.compliance.model` | With config |
| Decide verdicts (`--verdicts`) | Routed; default Sonnet 5.5 (`phaxConfig.ts:213`); `--model` only, no `phax.json` key | With a flag on every call |
| Decide, interactive | Claude Code only: `--model … is not a Claude Code model — decide runs on Claude Code only` (`src/domain/decide/model.ts:45-46`); spawns `claude` (`src/app/decideArtifact.ts:627-643`); handback `provider: "claude-code"` (`:772`) | No |
| Plan extraction (LLM fallback) | `provider: "claude-code"` hard-coded (`src/app/extractPlan.ts:84`); runs only when the deterministic parse fails | No |
| `adjust-plan`, interactive `review-code`, `phax enter`, a stop's continue command | Session adapter; Mistral returns `unsupported` (`src/domain/session/mistral.ts:31-73`) | No; an interactive phase gets a fresh Vibe TUI instead of the agent's session |
| Cost ledger, `phax cost`, `phax plans estimate`, window probe | `if (opts.provider !== "claude-code") return invocation;` (`src/app/costLedger.ts:134`); `notEstimated: "other-provider"` (`src/domain/cost/estimate.ts:382-384`); probe always Claude (`src/infra/providers/dispatcher.ts:124`) | No. Run, authoring and decision records do carry Vibe's usage and `costUsd` (`src/app/recordPlumbing.ts:311-322`) |
| Planner doctrine | `PHASE_MODEL_POLICY` names Claude only (`src/domain/routing/phaseModelPolicy.ts:22-26`); the skill offers efforts `low \| medium \| high` | A planner told to use Mistral can, with a reason line; by default it never does |
| Security and confinement | Capabilities `filesystemJail: "strong"`, `commandEnforcement: "prefix"`, `mcpAllowlist: "unsupported"` (`src/domain/security/capabilities.ts:27-31`) | Yes |

Routing also has its own limits:

- Only two Claude ids have a Mistral edge: `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`
  (`src/domain/routing/defaults.ts:100-103`). Every built-in default is a 5.5 id.
- An edge is keyed by the spoke's effort, so one Mistral model stands in for at most one Claude id per effort.
- The terminal Claude fallback ignores `enabled` (`src/domain/routing/resolve.ts:271-406`). That fix belongs to
  `mistral-large-4`; this spec depends on it.

**Vibe 3.1.3's CLI** (`vibe --help`, read 2026-11-24): `vibe [OPTIONS] [INITIAL_PROMPT]`, documented as "Initial prompt
for the interactive session". It also takes `-c/--continue` and `--resume [SESSION_ID]`. The adapter still says the
interactive forms are "unverified" (`mistral.ts:23-27`), and that pre-prompted sessions are unsupported. The spec
checks them on the installed CLI before designing around a gap that may be gone. `--model` and `--thinking` remain
headless-only.

## Depends on

`mistral-large-4`: the catalog entry, and "a disabled provider never runs". Without it, "all on Mistral" quietly
includes Claude.

## What to decide

- **The configuration surface.** Today, all-on-one-provider means one model key per job, a flag on every decide call,
  and edges in `~/.phax/model-routing.json`. Options:
  - **A key per job**, completed: verdicts and extraction get one; decide gets one if it can run elsewhere.
  - **One "phax's own jobs run on" provider setting**, with a model per job taken from that provider's catalog.
  - **Both**: the per-job key wins.

  Say where each lives (`phax.json` against `~/.phax`). Today routing has no `phax.json` key
  (`src/app/loadRouting.ts:23-24`).
- **Each Claude-only job.** For each one, say whether it gains a Vibe path or refuses by name when Claude is disabled:
  - interactive decide;
  - plan extraction, which only a failed deterministic parse reaches;
  - `adjust-plan` and interactive `review-code`;
  - `phax enter` and the continue command.

  Nothing may stay silently Claude.
- **Vibe interactive sessions**, if the CLI check confirms `INITIAL_PROMPT` and `--resume <id>` in the TUI. They need
  pre-prompted and resumed invocations, and a stated answer for the model and thinking level, which the TUI does not
  take by flag (today: `VIBE_ACTIVE_MODEL`, default thinking).
- **Cost for Vibe.** Whether the ledger, `phax cost` and `plans estimate` read Vibe's `export.json` cost. The ledger
  schema's `provider: Schema.Literal("claude-code")` (`src/schemas/costLedger.ts:51`) becomes a union. Persisted
  formats get no back-compat shim, so name the version bump. The probe and the windows stay Claude-subscription
  concepts; say what a Vibe-only estimate shows in their place.
- **The planner's doctrine per provider.** `PHASE_MODEL_POLICY` gets a default, stronger and lighter model for each
  provider, with each provider's own efforts (Vibe: whatever `mistral-large-4` finds; not `low | medium | high` by
  assumption). Also say how the operator tells the planner "Mistral only": a `phax.json` setting the skill renders, or
  assignment bounds (`phax.json`, `docs/specs/archive/2610201350-assignment-bounds.md`), which already make a phase
  outside its bound a lint error.
- **Task floors** (see Why). Whether this spec ships them, or only records the evidence that would set them. Choices to
  weigh:
  - The floor's scale: a Claude reference model ("at least Opus 4.5"), or the Epoch Capabilities Index, the one axis
    that stays comparable across generations and providers.
  - Who declares it: the phase, the task kind, or the job.
  - Where the evidence comes from: records rather than benchmarks — gates passed, fix attempts, review defects by
    origin. NEXT_STEPS "Model policy tracking" already logs this, one row per run, for the Sonnet 5.5 default.

## §9 — the choice to settle first (options, the dominant loss of each, a recommended default)

- **How much this spec carries.**
  - **The minimal slice** (recommended): honour or refuse. Every job takes its provider from configuration or refuses
    by name, decide verdicts and extraction get their keys, cost reads Vibe, and the planner can be told
    "this provider only". Loses: no automatic choice of a cheaper provider by task; the operator names Mistral by hand
    until floors exist.
  - **The slice plus Vibe interactive sessions.** Loses: an interactive phase or `adjust-plan` keeps starting a fresh
    Vibe session until then, but decide is still Claude-bound by design.
  - **Everything, including task floors.** Loses: the floors get designed before any records show what a task actually
    needs on Mistral. The operator's rule: ship the smallest useful part, and let usage answer the rest.

## Constraints

- No back-compat shims in persisted schemas. A new field is required, and a format that changes says so in
  `docs/upgrading.md`.
- `phax` runs stay autonomous. A job that cannot honour the provider choice refuses before it starts. It never pauses
  to ask.
- Real-provider tests run deliberately (`pnpm test:e2e:real`). Unit tests reach no provider.
