---
status: Draft
date: 2026-11-04
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---
# Scoped checks on gate steps

## 1. Context

After the prerequisite `phase-prompt-names-the-gate`, every phase prompt carries a `## Gate` section. It lists the phase gate list, one `- <surface>: <command>` line per step in run order. It states that a failing step resumes the same session with its output, and it tells the agent to check each change with the narrowest command that covers it. That prerequisite cannot say what the narrowest command is for a given project, and it rules out per-step advice in `phax.json`.

A gate step in `phax.json` `gateProfiles` today:

    { "command": "pnpm test", "surface": "local", "firing": "every-phase" }

(plus an optional `output` and `input`). Gate profiles live in the project config, the user layers and workspaces. Layers merge by name, and an unknown key is refused at config load.

Measured on phax's records (2026-11-04, 318 phase sessions), phases spend 27% of their wall time waiting on feedback commands they run themselves. Whole-suite test runs are the largest share: 6.7 h over 403 calls, against 1.3 h over 1,193 targeted calls. On this repository the whole suite takes 270 s wall and `test:unit` 33 s, and integration tests are 92% of the test time. Agents find the targeted forms on their own (`pnpm test <file>`, `pnpm vitest run <file>`, `pnpm exec vitest run <file>`, `pnpm test:unit`), and each session rediscovers them. In other projects (steme, where command latency is growing) the right partial command cannot be guessed. Computing the scope in phax does not pay either: `vitest related src/app/gates.ts` selects 99 of 613 test files (203 s), because core modules are imported by most integration tests.

In secure mode, which is the default, a phase's shell runs only the frozen agent command set: `security.agentCommands` plus every gate command of the profile. On Claude Code each is a `Bash(<cmd>:*)` rule, and on Vibe each is a prefix allowlist entry. Codex has no per-command allowlist and runs any command inside its OS sandbox.

Ground read:

- `docs/specs/2611041203-phase-prompt-names-the-gate.md` — Prerequisite (Draft, decided). The phase prompt gains a `## Gate` section: the phase gate list as `- <surface>: <command>` lines in run order, the gate contract, and the instruction to check each change with the narrowest command that covers it. It names no command, and its non-goals exclude per-step advice in phax.json.
- `src/schemas/phaxConfig.ts` — GateStepSchema has `command`, `surface`, `firing`, `output` (default "log") and an exact-optional `input`. GateProfilesSchema maps a profile name to a non-empty array of steps and is carried by the project config, the user overlay and each workspace. Both decoders use onExcessProperty: "error", so a phax release refuses a key it does not know.
- `phax.json` — The `standard` profile: six local steps (format, typecheck, test:type, lint, format:check, test), three structural steps and four terminal product steps. `security.agentCommands` lists extra prefixes (such as `pnpm test:integration` and `pnpm exec tsx`). `pnpm test:unit` and `pnpm exec oxlint` are not among them. No `security.profile` is set, so the profile is `secure`.
- `package.json` — `test` is `vitest run`, so `pnpm test <file>` runs one file. `test:unit` is `vitest run tests/unit`. `lint` is `oxlint .`, so `pnpm lint <file>` still lints the whole tree.
- `src/domain/security/agentCommands.ts` — The frozen agent command set of a phase is security.agentCommands ∪ every gate command of the profile (whatever its firing) ∪ brief commands. A multi-word entry is a prefix. checkRequiredCommands treats a command as covered when it equals an entry, or when a one-word entry is its first word.
- `docs/security.md` — In secure mode Claude Code allowlists each agent command as `Bash(<cmd>:*)` and Vibe applies a prefix allowlist, so a command outside the set is denied. Codex has no per-command allowlist and runs any command inside its OS sandbox. `phax run --security <profile>` sets the run's mode.
- `README.md` — "Set up a project" documents `gateProfiles` step keys and config layers: agentCommands is a union across layers, and gate profiles merge by name. Exit code 2 means plan or config validation.
- `docs/ideas/harness-from-records.md` — 318 phase sessions (2026-11-04). Phases spend 27% of their wall time on feedback commands they run themselves: 6.7 h in 403 whole-suite runs against 1.3 h in 1,193 targeted runs. Agents rediscover the targeted forms in every session. `vitest related src/app/gates.ts` selects 99 of 613 test files (203 s).

## 2. Problem

The prerequisite tells the agent to check each change with the narrowest command that covers it, but it gives the agent no such command. Each session rediscovers the targeted forms by trial, at the cost of exploratory runs. Sometimes it never finds them and falls back to the whole step, the most expensive feedback in the records. The project knows its cheap partial commands (a unit tier, one test file, a linter on named files), and phax cannot infer them: diff-based selection was measured not to pay on this repository. Nothing in the config gives the project a place to say what they are, so the knowledge never reaches the agent. Under secure mode there is a second trap: an agent that guesses a partial command outside the agent command set is denied, and it learns that only by trying.

## 3. Product goal

A project declares, on a gate step, the cheaper commands that each check part of what the step checks. Every phase whose gate runs that step shows them to the agent under the step's line, so in-loop feedback uses the project's own narrow commands from the first turn. phax never runs them, and the gate still judges the whole step.

> phax tells the agent how this project checks a part, and the gate still checks the whole.

## 4. Terminology

- **gate step** — One entry of a gate profile: `command`, `surface`, `firing`, and optionally `output` and `input`.
- **scoped check** — A command a project declares on a gate step that checks part of what the step checks, for example one test file, one tier, or named files. Each has a command text and a scope label. phax shows it and never runs it.
- **scope label** — A short human label on a scoped check that says which part it covers, for example "unit tier" or "one or more test files". It tells the agent when to use which check.
- **phase gate list** — As in `phase-prompt-names-the-gate`: the steps the gate will run for one phase. That is the every-phase steps, plus the terminal steps on the terminal phase, in run order.
- **gate section** — The `## Gate` part of the phase prompt introduced by `phase-prompt-names-the-gate`.
- **agent command set** — The commands a phase's shell may start under the secure profile: `security.agentCommands` from every config layer, plus every gate command of the profile in use, whatever its firing.
- **covered** — A scoped check is covered when the whitespace-separated words of its command begin with all the words of some entry in the agent command set of its profile. Example: `pnpm test <test-file>...` is covered by the gate command `pnpm test`, while `pnpm test:unit` is not.

## 5. Functional requirements

### 5.1 Scoped checks are declared on the gate step

WHERE a gate step in any gate profile (project config, user layers or a workspace) declares `scopedChecks` THE system SHALL accept it as a non-empty list whose entries each carry a non-empty `scope` and a non-empty `command`, and SHALL accept a step without the key exactly as today.

### 5.2 A malformed declaration is refused

IF a gate step's `scopedChecks` is empty, or an entry lacks `scope` or `command`, has an empty one, or carries an unknown key, THEN the system SHALL refuse the config at load as a config validation error naming the profile and the step's command.

### 5.3 Scoped checks are shown under their step

WHERE a step in the phase gate list declares scoped checks THE system SHALL show each of them in the gate section directly under that step's line, in declared order, with its scope label and its command.

### 5.4 The command text is shown verbatim

The system shall show a scoped check's command exactly as declared, with no placeholder substitution, expansion or rewriting.

### 5.5 Scoped checks follow their step

IF a step is not in the phase gate list (a terminal step on a non-terminal phase) THEN the system SHALL show none of that step's scoped checks anywhere in the phase prompt.

### 5.6 The section says what a scoped check is

WHERE at least one step in the phase gate list declares scoped checks THE system SHALL state in the gate section that a line under a step is a cheaper command that checks part of what that step checks, that phax does not run it, and that the gate still runs the whole step.

### 5.7 No scoped checks, no change

IF no step in the phase gate list declares scoped checks THEN the system SHALL render a gate section byte-identical to the one `phase-prompt-names-the-gate` renders for the same phase.

### 5.8 phax never runs a scoped check

The system shall not execute a scoped check: not at the gate, in the fix loop, at preflight, in `phax validate`, in `phax plans lint` or in authoring.

### 5.9 The gate judges the whole step

The system shall run the same gate steps with the same commands in the same order as without scoped checks, and decide each step's result from that step's command alone.

### 5.10 Scoped checks grant no shell access

The system shall leave a phase's agent command set, and the commands recorded in its security record, unchanged by the scoped checks of its profile.

### 5.11 An uncovered scoped check is refused under secure mode

IF the security profile in effect is `secure` (from `security.profile` or `phax run --security secure`) and a scoped check of any gate profile is not covered by that profile's agent command set THEN the system SHALL refuse the config before any phase starts, naming the profile, the step's command and the scoped check's command.

### 5.12 Provider-agnostic rendering

The system shall render the same scoped-check lines for the same phase whichever provider runs it, and the fixed wording it adds shall name no tool or package manager.

### 5.13 A resumed phase shows the same scoped checks

WHEN a phase prompt is regenerated on `phax resume` THE system SHALL show the same scoped-check lines as the phase's first prompt.

### 5.14 The editor schema describes scoped checks

The system shall describe `scopedChecks` on a gate step in the config JSON Schemas it generates (`phax.schema.json`, `phax.user.schema.json`), including that phax shows scoped checks to the agent and never runs them.

## 6. Surface

### config: phax.json gateProfiles step scopedChecks — indicative

Summary: A project can list, on a gate step, the cheaper commands that check part of what that step checks, so phase agents get them instead of guessing.

before:

    "gateProfiles": {
      "standard": [
        { "command": "pnpm lint", "surface": "local", "firing": "every-phase" },
        { "command": "pnpm test", "surface": "local", "firing": "every-phase" }
      ]
    }

after:

    "gateProfiles": {
      "standard": [
        {
          "command": "pnpm lint", "surface": "local", "firing": "every-phase",
          "scopedChecks": [
            { "scope": "one or more files", "command": "pnpm exec oxlint <file>..." }
          ]
        },
        {
          "command": "pnpm test", "surface": "local", "firing": "every-phase",
          "scopedChecks": [
            { "scope": "unit tier", "command": "pnpm test:unit" },
            { "scope": "one or more test files", "command": "pnpm test <test-file>..." }
          ]
        }
      ]
    }

### internal: phase prompt gate section with scoped checks — indicative

Summary: A phase agent sees the project's scoped checks under the gate step they narrow, and knows phax will not run them but will still run the whole step.

before:

    ## Gate

    After this session ends, phax runs these gate steps, in order:

    - local: pnpm format
    - local: pnpm lint
    - local: pnpm test
    - structural: pnpm knip

    If a step fails, phax resumes this same session with its output and you fix it here.
    While you work, check each change with the narrowest command that covers it.
    You need not run a whole gate step before finishing: the gate runs it.

after:

    ## Gate

    After this session ends, phax runs these gate steps, in order:

    - local: pnpm format
    - local: pnpm lint
      - one or more files: pnpm exec oxlint <file>...
    - local: pnpm test
      - unit tier: pnpm test:unit
      - one or more test files: pnpm test <test-file>...
    - structural: pnpm knip

    If a step fails, phax resumes this same session with its output and you fix it here.
    While you work, check each change with the narrowest command that covers it.
    You need not run a whole gate step before finishing: the gate runs it.
    A line under a step is a scoped check this project declares: a cheaper command that
    checks part of what that step checks. phax does not run it; the gate still runs the whole step.

### cli: phax validate (secure-mode refusal) — indicative

Summary: Under the secure profile, `phax validate` and `phax run` refuse a scoped check the agent would not be allowed to run, and name the command to add or remove.

    $ phax validate
    ✗ phax.json: gateProfiles.standard, step "pnpm test": scoped check "pnpm test:unit" is not
      covered by security.agentCommands or the profile's gate commands, so a phase cannot run it
      under the secure profile.
      Add "pnpm test:unit" to security.agentCommands, or remove the scoped check.
    $? = 2

### cli: phax validate (shape refusal) — indicative

Summary: A malformed scoped check is refused at config load, with the profile and the step it sits on.

    $ phax validate
    ✗ phax.json: gateProfiles.standard, step "pnpm test": scopedChecks[1].scope is missing
    $? = 2

### file: phax.schema.json — indicative

Summary: An editor checking phax.json knows the `scopedChecks` key on a gate step and explains that phax shows it to the agent and never runs it.

before:

    "command": { "type": "string", "minLength": 1 },
    "surface": { ... },
    "firing": { "enum": ["every-phase", "terminal"] }

after:

    "scopedChecks": {
      "type": "array", "minItems": 1,
      "description": "Cheaper commands that check part of what this step checks. phax shows them to the phase agent under the step and never runs them; the gate still runs the whole step.",
      "items": {
        "type": "object", "additionalProperties": false,
        "required": ["scope", "command"],
        "properties": {
          "scope": { "type": "string", "minLength": 1 },
          "command": { "type": "string", "minLength": 1 }
        }
      }
    }

## 7. Non-goals

- phax running a scoped check, or choosing one from the diff (`--changed`, `vitest related`): measured not to pay on this repository.
- Timing gate steps or reporting how a phase changed feedback speed (a feedback-speed sensor): a separate spec.
- Showing scoped checks in fix attempt prompts, the interactive-stop guide, or authoring, decide, review, brief and plan-extraction prompts.
- Granting shell access from a scoped check: it never widens the agent command set.
- Forbidding or detecting whole-step runs inside a session: the agent keeps access to everything the security profile allows.
- Scoped checks on the acceptance provider command, which is not a gate step.
- A description field on the gate step itself.
- Making this repository's tests faster.

## 8. Acceptance criteria

### Scoped checks appear under their step, verbatim

Given a `standard` profile whose `pnpm test` step declares `{ "scope": "unit tier", "command": "pnpm test:unit" }` then `{ "scope": "one or more test files", "command": "pnpm test <test-file>..." }`, with both commands covered, when phax writes the first phase's prompt.md, then the line `- local: pnpm test` in its `## Gate` section is directly followed by `  - unit tier: pnpm test:unit` and `  - one or more test files: pnpm test <test-file>...`, in that order. `<test-file>...` appears unchanged, and no other step line has sub-lines. (refs §5.1, §5.3, §5.4)

### The section explains scoped checks when there are any

Given the profile of ac-shown-under-step, when the phase prompt is generated, then the `## Gate` section states that a line under a step is a cheaper command checking part of that step, that phax does not run it, and that the gate still runs the whole step. (refs §5.6)

### A terminal step's scoped checks appear on the terminal phase only

Given a two-phase plan whose terminal step `pnpm build` declares the scoped check `{ "scope": "one package", "command": "pnpm build --filter <package>" }`, when phax writes both phases' prompt.md, then the first phase's prompt contains no `pnpm build --filter` anywhere, and the terminal phase's `## Gate` section shows it under `- product: pnpm build`. (refs §5.5, §5.3)

### Without scoped checks the section is unchanged

Given a profile in which no step of the phase gate list declares `scopedChecks`, including one where only a terminal step declares them on a non-terminal phase, when the phase prompt is generated, then its `## Gate` section is byte-identical to the one `phase-prompt-names-the-gate` produces for the same phase, and the scoped-check sentence is absent. (refs §5.7, §5.1)

### phax never runs a scoped check, and the gate judges the step

Given a profile run under the `unsafe` profile whose `pnpm test` step declares the scoped check `{ "scope": "marker", "command": "touch scoped-ran && exit 1" }`, and a phase whose `pnpm test` passes, when `phax validate`, `phax plans lint` and a full `phax run` (gate and fix loop included) complete, then no `scoped-ran` file exists in any worktree, the gate attempt records list only the profile's step commands in profile order, and the `pnpm test` step is recorded as passed. (refs §5.8, §5.9)

### A malformed declaration is refused

Given a `phax.json` whose `pnpm test` step has `"scopedChecks": []`, or an entry without `scope`, or an entry with an extra key `"why"`, when `phax validate` runs, then it exits 2 and names `gateProfiles.standard` and the step `pnpm test`. (refs §5.2)

### An uncovered scoped check is refused under secure mode

Given a `phax.json` with no `security.profile` (so `secure`) whose `pnpm test` step declares `pnpm test:unit`, with no `pnpm test:unit` entry in `security.agentCommands` and no such gate command, when `phax validate` runs, and separately `phax run` runs, then both exit 2 before any phase starts and name the profile, the step `pnpm test` and the scoped check `pnpm test:unit`. (refs §5.11)

### The run-time secure flag applies the same check

Given the config of ac-secure-uncovered with `security.profile` set to `unsafe`, when `phax validate` runs, then `phax run --security secure` runs, then `phax validate` accepts the config, and `phax run --security secure` refuses it before any phase starts, naming the same profile, step and check. (refs §5.11)

### A covered scoped check is accepted

Given a secure-mode config whose `pnpm test` step declares `pnpm test <test-file>...` (covered by the gate command `pnpm test`) and `pnpm test:unit`, with `pnpm test:unit` added to `security.agentCommands` in a user layer, when `phax validate` runs, then it accepts the config. (refs §5.11)

### Scoped checks grant nothing

Given two runs of the same plan whose profiles differ only by scoped checks, when each phase writes its security record, then the recorded agent commands are identical between the two runs, and so are the shell permissions passed to the provider. (refs §5.10)

### Same lines for every provider

Given the same phase with scoped checks routed once to Claude Code, once to Codex and once to Vibe, when each prompt is generated, then the three `## Gate` sections are byte-identical, and with step and scoped-check commands removed they contain none of `pnpm`, `npm`, `vitest`, `jest`, `oxlint` or `cargo`. (refs §5.12)

### Resume keeps the scoped checks

Given a run with scoped checks interrupted during a non-terminal phase, when `phax resume` regenerates that phase's prompt, then its scoped-check lines are identical to those in the phase's first prompt. (refs §5.13)

### The editor schema knows the key

Given phax's generated `phax.schema.json` and `phax.user.schema.json`, when a `phax.json` with a well-formed `scopedChecks` is validated against them, and one with `"scopedChecks": []` is too, then the first validates, the second is rejected, and the `scopedChecks` description says phax shows the checks to the agent and never runs them. (refs §5.14)

## 9. Open questions

### q-shape — What shape does a step's scoped checks take?

- pairs — A non-empty list of `{ scope, command }` — abandons: Brevity: every check needs a label, even when the command speaks for itself.
- commands — A non-empty list of command strings — abandons: The agent's cue for when to use which check. With two or more checks on a step (tier vs one file), it has to work out from the command alone what each covers.
- hint — A single free-text hint per step — abandons: A command phax can check for coverage under secure mode, plus a uniform line shape in the prompt; the hint becomes the unstructured description the prerequisite ruled out.

Recommendation: pairs — The label is the cheapest way to tell the agent which part each check covers, without adding a description field on the step itself. It also keeps `command` a single piece of text that phax can test for coverage. Writing a few words per check is the smallest loss.

### q-placeholder — How does a scoped check say where file paths go?

- plain-text — Plain text: the command reads as an example (`pnpm test <test-file>...`), and phax renders nothing — abandons: Any check by phax that a placeholder is well-formed or used consistently across projects.
- convention — A documented `<name>` / `<name>...` convention that phax recognises, and refuses when malformed — abandons: Free-form commands: phax gains a small grammar for text it never runs, and a project's existing notation may be refused.
- rendered — A declared placeholder that phax fills in when it renders the prompt — abandons: The settled rule that phax neither derives scope from the diff nor runs anything; at prompt time there is nothing phax could honestly fill in.

Recommendation: plain-text — phax never runs a scoped check, so the text only has to read well to the agent, and agents read `<test-file>...` correctly. Coverage stays well-defined, because it looks at the leading words, which come before any placeholder. Losing a format check on text nobody executes is acceptable.

### q-secure — Under secure mode, what happens to a scoped check that is not covered by the profile's agent command set?

- refuse — Refuse the config before any phase starts, naming the profile, step and check — abandons: Projects that run only on Codex, where the uncovered check would run, must still add the prefix to `security.agentCommands` or drop the check.
- warn — Warn at load and show it anyway — abandons: A prompt that tells the truth: Claude Code and Vibe phases are offered a command they will be denied, and the warning scrolls by before a long run.
- show — Show it anyway, silently — abandons: The whole point under secure mode: the agent tries the offered command, is denied, and loses a turn learning it.
- grant — Add the check's leading words to the agent command set — abandons: The rule that only `security.agentCommands` and gate commands widen the shell: a prompt hint would silently grant execution, and with plain-text placeholders phax would have to guess where the runnable prefix ends.

Recommendation: refuse — An offered command the agent cannot run is worse than none: it turns a cheap check into a denied call and a lost turn. Provider routing is decided per phase, so a secure config cannot assume Codex. Refusing at load keeps the security model unchanged and the fix obvious: add the prefix, or drop the check. Asking Codex-only projects to add one line is the acceptable loss.

### q-phases — Which phases show a step's scoped checks?

- follow-step — Exactly the phases where the step is listed in the gate section — abandons: Telling a non-terminal phase how to anticipate a terminal step (for example a cheap build check), which it learns only on the terminal phase.
- every-phase — Every phase, including the checks of terminal steps on non-terminal phases — abandons: The prerequisite's single-resolution rule: the prompt would again show checks for a step the gate will not run on that phase, the very mismatch the prerequisite removed.

Recommendation: follow-step — A scoped check anticipates its step's result, so it belongs where the step is judged. Showing terminal-step checks early reintroduces the redundant product work the prerequisite cut. The terminal phase is the one that has to pass that step, and it still sees them.

### q-own-profile — Should this repository's `standard` profile get scoped checks as part of this change, as the reference example?

- after-release — Yes, in a follow-up commit once the release that accepts `scopedChecks` is installed, adding `pnpm test:unit` and `pnpm exec oxlint` to `security.agentCommands` — abandons: Measuring the effect from the very next run: the first measured runs come one release later.
- last-phase — Yes, in the run's last phase — abandons: Working runs: phax refuses unknown config keys, so from merge until the release ships, every run driven by the installed phax refuses this repository's `phax.json`.
- no — No: the docs show an illustrative profile only — abandons: A real, measured reference: the docs example is untested against a real project, and phax's own records never show the effect.

Recommendation: after-release — Runs use the released phax, and its config decoder refuses keys it does not know, so adding the key in the last phase breaks this repository's runs until the release. A follow-up commit after the release gives the same real example and the same measurements, one release later. Under secure mode it must also add `pnpm test:unit` and `pnpm exec oxlint` to `security.agentCommands`; `pnpm test <test-file>...` is already covered by the gate command. The delay is the acceptable loss.

## 9b. Arbitrated questions

None.

## 10. Implementation-planning note

Settled:

- Scoped checks are declared on the gate step in `gateProfiles` (project, user layers, workspaces), next to `command`, `surface` and `firing`. There is no separate list elsewhere in the config.
- phax shows scoped checks and never runs them: not at the gate, the fix loop, preflight, validate, lint or authoring. The gate's steps, commands, order and judgement are unchanged.
- The key is optional per step. A phase gate list without scoped checks renders a gate section byte-identical to `phase-prompt-names-the-gate`'s.
- phax treats a scoped check as text: nothing in phax knows `vitest`, `pnpm` or `oxlint`, and all three providers see the same lines.
- The agent keeps access to everything the security profile allows. Scoped checks neither forbid the whole command nor widen or narrow the shell.
- Scoped-check lines come from the same resolved steps the gate runs, the single resolution the prerequisite introduces.

Left open:

- The §9 answers: shape, placeholders, secure-mode handling, which phases show the checks, and this repository's own profile.
- The exact key spelling (`scopedChecks`), the line layout under a step, the explanatory sentence, and the refusal wording. The §6 sketches are indicative.
- Whether the secure-mode coverage check reuses the existing required-command coverage rule or a word-prefix rule over the full agent command set. §4 `covered` defines the intent: leading words match an entry.

Constraints:

- Prerequisite: `phase-prompt-names-the-gate` must ship first. This spec extends its gate section and its resolution.
- phax decodes config with onExcessProperty "error". A release before this one refuses `scopedChecks`, so this repository adopts it only after the release is installed (runs use the released phax).
- Coverage is judged on the merged config (the same layers the frozen agent command set is built from), per profile, including workspace profiles, and against every gate command of that profile whatever its firing.
- Secure-mode refusal is provider-independent, because routing is decided per phase.
- Scoped checks must not enter any persisted run record shape (run state, gate attempt records, security records). They are prompt input only.
- `phax.schema.json` and `phax.user.schema.json` are generated: regenerate them, never hand-edit. Prompt snapshots change only where a fixture declares scoped checks.

## 11. Docs page

Page: README "Set up a project" (the `gateProfiles` bullet and the example `phax.json`), with a short "Scoped checks" paragraph

Reader: An operator setting up a project's gate profiles who wants phase agents to use the project's fast partial checks instead of rerunning whole steps.

Example: A `pnpm test` step declaring `{ "scope": "unit tier", "command": "pnpm test:unit" }` and `{ "scope": "one or more test files", "command": "pnpm test <test-file>..." }`. The page shows the lines they produce under `- local: pnpm test` in a phase prompt and notes that under the secure profile each check must start with an agent command or a gate command.
