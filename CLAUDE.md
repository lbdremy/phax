# CLAUDE.md

Guidance for AI agents working in this repo. Keep this file lean — detailed rules live in
the project skills (see the table below); the README covers user-facing usage.

## What phax is

A deterministic local CLI that drives an AI coding agent (Claude Code, Mistral Vibe, or
OpenAI Codex) through isolated, **gated phases**. Each phase runs in its own Git worktree
with a same-session fix loop and a kept-open final phase for human review. Provider
selection is handled by the model-routing layer; Claude Code is the default and fallback.

## Commands

Use the package scripts — don't reach for raw tool invocations.

- `npm run check:full` — the real pre-merge gate (typecheck + unit + integration + type
  tests + lint + format check + architecture audit + knip). Run this before considering
  work done.
- `npm run dev` — run the CLI from source (`tsx src/cli/main.ts`).
- `npm run build` — compile to `dist/`.
- `npm run test:unit` / `test:integration` / `test:e2e:real` — test tiers (e2e hits real
  provider CLIs; run deliberately).
- `npm run test:type` — type-level tests (`tsconfig.test.json`).
- `npm run audit:architecture` — enforces the layer boundaries below as a test.
- `npm run lint` / `lint:fix` — **oxlint** (not eslint).
- `npm run format` / `format:check` — **oxfmt** (not prettier).
- `npm run knip` — dead-code / unused-dependency check.

## Architecture

Four layers, dependencies point inward; side effects only at the edge:

```
cli → app → domain ← ports ← infra
```

- `src/domain/` — pure logic (state machines, routing, reconciliation, security). No I/O.
- `src/ports/` — interfaces for all side effects (fs, git, shell, github, editor, lock,
  output, telemetry).
- `src/infra/` — the only place side effects live; adapters implementing the ports.
- `src/app/` — use cases orchestrating domain + ports via Effect dependency injection.
- `src/cli/` — thin command layer: parse args, call one use case, render via OutputPort.
- `src/schemas/` — Effect Schemas decoding every external input at the boundary.

Non-negotiables (enforced by `audit:architecture`):

- All I/O goes through a port; never call fs/shell/git directly in `app/`, `domain/`, or `cli/`.
- Decode external input (files, env, CLI args, API responses) through a schema before it
  enters the domain.
- Transition `RunState`/`PhaseState` only through the functions in `src/domain/state.ts`.
- CLI command files contain no business logic.

## Project skills

These load on demand. Reach for the matching one before editing that area:

| Skill                     | When                                                          |
| ------------------------- | ------------------------------------------------------------- |
| `boundaries`              | adding/moving code across the four layers                     |
| `cli-view-layer`          | touching `src/cli/commands/`                                  |
| `effect-services`         | adding a side-effecting operation (route it through a port)   |
| `infrastructure-adapters` | implementing an adapter in `src/infra/`                       |
| `validation-boundaries`   | decoding any external input                                   |
| `state-machines`          | changing `RunState`/`PhaseState` transitions                  |
| `model-routing`           | provider adapters, model families/tiers, resolution algorithm |
| `observability`           | OpenTelemetry / `SystemTelemetry` port wiring                 |
| `phax-planning`           | authoring/reviewing `plan.md` → `phax-plan.json`              |

## Conventions

- TypeScript + Effect (v3) throughout; Effect handles dependency injection and effects.
- Schemas pin to specific library versions — when checking an Effect / `@effect/platform`
  API, cross-check against `package.json`; installed versions may differ from training data.
- No back-compat shims in persisted schemas: new fields are required, not optional.
- Prefer explicit per-variant enums over a permissive superset.
