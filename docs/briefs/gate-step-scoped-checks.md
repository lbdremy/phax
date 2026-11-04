Write the phax spec "Scoped checks on gate steps". A project can declare, on a gate step, the cheaper commands that check part of what the step checks (one test file, one tier, the files a phase touched), and the phase prompt's gate section shows them to the agent beside the step. The agent keeps access to everything; it is told how to check a part.

**Builds on** `docs/specs/2611041203-phase-prompt-names-the-gate.md` (Draft, decided): the phase prompt gains a `## Gate` section listing the resolved gate steps with their surface, says a failing step resumes the same session, and that in-loop the agent checks each change with the narrowest command that covers it. That spec names no command: it cannot tell the agent *what* the narrowest command is for this project. This spec lets the project say it, in config, next to the step it narrows. Name it as a prerequisite.

**Why.** The feedback loop is half of the harness. Measured on phax's records (2026-11-04, 318 phase sessions; `docs/ideas/harness-from-records.md`, `spikes/harness-data/`):
- Phases spend 27% of their wall time waiting on the feedback commands they run themselves; whole-suite test runs are the largest share (6.7 h over 403 calls), against 1.3 h over 1,193 targeted calls.
- On this repository the whole suite takes 270 s wall, `test:unit` 33 s; integration tests are 92% of the test time.
- The agent finds the targeted forms on its own (`pnpm test <file>`, `pnpm vitest run <file>`, `pnpm exec vitest run <file>`, `pnpm test:unit`), each session rediscovering them; in another project (steme, where command latency is growing) the right partial command is not guessable.
- phax computing the scope itself does not pay here: `vitest related src/app/gates.ts` selects 99 of 613 test files (203 s), because core modules are imported by most integration tests. The project knows its cheap tiers; phax does not.

**Settled (do not reopen):**
1. **Declared on the gate step**, in `phax.json` `gateProfiles`, next to `command`, `surface`, `firing`: the scoped checks belong to the step whose result they anticipate. No separate list elsewhere in the config.
2. **Shown, never run by phax.** The gate itself is unchanged: same steps, same whole commands. phax does not execute a scoped check, does not derive it from the diff, and does not judge the session on it.
3. **Optional per step.** A step without scoped checks is shown as `phase-prompt-names-the-gate` shows it; a profile with none produces the same prompt as that spec.
4. **Project- and provider-agnostic.** phax treats a scoped check as text plus whatever placeholder convention the spec settles; nothing in phax knows `vitest` or `pnpm`. Claude Code, Codex and Vibe phases see the same lines.
5. **The agent keeps access to everything.** The prompt offers the scoped checks; it neither forbids the whole command nor restricts the shell beyond what the security profile already does.

**What exists (read it first):**
- `src/schemas/phaxConfig.ts`: `GateStepSchema` (`command`, `surface`, `firing`, `output` with a default, `input` exact-optional), `GateProfilesSchema`; the project and user config schemas that carry `gateProfiles`.
- `phax.json` (this repository's `standard` profile) and `phax.schema.json` (generated).
- `src/app/promptGeneration.ts`, `src/app/executePlan.ts`, `src/app/gates.ts`: prompt building and gate resolution, as `phase-prompt-names-the-gate` changes them.
- `security.agentCommands` in `phax.json` and `docs/security.md`: in secure mode a shell command runs only if it matches an agent command; a scoped check the agent is offered but cannot run would be a trap.

**Out of scope:**
- phax running scoped checks, or choosing them from the diff (`--changed`, `related`);
- timing gate steps (a feedback-speed sensor): a separate spec;
- authoring, decide and review prompts;
- making this repository's tests faster.

**Open questions for §9 (each with a recommendation):**
1. **Shape.** A list of commands per step, a list of `{ command, scope }` pairs where `scope` is a short human label ("one test file", "unit tier"), or a single free-text hint? Recommendation: a non-empty list of `{ command, scope }` — the label tells the agent when to use which, without a description field on the step itself.
2. **Placeholders.** How does a scoped check say "put file paths here": a literal convention in the text (`<test-file>...`), a declared placeholder phax renders, or nothing (the agent reads the command as an example)? Recommendation: plain text, no phax-rendered placeholder — phax never runs it, so it only has to read well to the agent.
3. **Secure mode.** A scoped check that matches no `security.agentCommands` entry cannot run under secure mode. Refuse such a config at load, warn, or show it anyway? Recommendation: refuse at config load in secure mode, naming the step and the check — an offered command the agent cannot run is worse than none.
4. **Which phases show them.** Every phase, or only phases whose gate actually runs the step (a terminal step's scoped checks on non-terminal phases)? Recommendation: follow the step — shown exactly where the step is listed.
5. **This repository's profile.** Should the spec also give phax's own `standard` profile its scoped checks (`pnpm test` → `pnpm test:unit`, `pnpm vitest run <test-file>...`; `pnpm lint` → `pnpm exec oxlint <file>...`), as the reference example? Recommendation: yes, in the last phase, so the docs page has a real example and the next runs measure the effect.
