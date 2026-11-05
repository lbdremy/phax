Write the phax plan "Architecture provider" for the approved spec `docs/specs/2610171254-planning-skill-defaults.md`. It is the second and last of the spec's two plans, so it carries `completes-spec: true`. Plan 1 (archived as `docs/plans/archive/2610190951-planning-skill-defaults-plan.md`) shipped §5.1–§5.16 and `modelReason`; do not redo any of it. Read the spec in full. Its six arbitrations are settled; do not reopen them. The ones that bind this plan:
- Q3: pull. The headless plan authoring prompt says whether a provider is configured, and the session may run `phax architecture` when one is.
- Q4: both commands exit 1 with no provider. `phax architecture` prints one stdout line meant for the agent; `phax brief` keeps its message.
- Q5: no record. `phax architecture` writes no file, inside a phase worktree or outside it.
- Q6: the report is `{ $schema, body }`, a Markdown body printed as is.

In scope: §5.17–§5.30, with their §6 surfaces (the `architecture` config key, `phax architecture [path]...`, the `architecture-request` and `architecture-report` formats, the headless prompt statements), every §8 criterion from "The skill says where the architecture comes from" onwards, and the §11 docs page.

Ground to read:
- **The sibling it follows: `phax brief`.**
  - the command: `src/cli/commands/brief.ts`;
  - the use cases: `src/app/pullBrief.ts`, `src/app/briefProvider.ts`;
  - the pure parts: `src/domain/brief/request.ts`, `src/domain/brief/pull.ts`;
  - the formats: `src/schemas/brief.ts`, `src/schemas/briefReport.ts`;
  - the config key and its layer merge: `src/schemas/phaxConfig.ts`, `src/domain/config/mergeLayers.ts`, `src/app/loadConfig.ts`.

  Reuse what is shared (spawning the provider through the Shell port with no shell, the time limit, decoding the answer by `$schema`, the one-line failures). Do not copy the brief's record-writing machinery: Q5 says nothing is written.
- **The phase guard:** `src/domain/security/phaseGuard.ts` and its test, which refuses an unclassified command. `phax architecture` is allowed, reading the config of the main checkout as `phax brief` does.
- **Formats:** `src/schemas/schemaUrl.ts`, `src/schemas/persisted.ts`, `docs/release.md` and the schemas package (`packages/schemas`). The two formats are schema-born in the open 0.26.0 `next` snapshots; the spec's `0.25.0` URLs are indicative.
- **Headless authoring:**
  - the prompt: `src/domain/authoring/prompt.ts`, `src/app/promptGeneration.ts`;
  - the session's spawn and its agent commands: `src/app/authorArtifact.ts`, `src/domain/security/agentCommands.ts`.

  Find how the session's command allowance and its read jail are built today (it runs only `git`). Work out what must be added so that it can run `phax architecture`, and so that phax can read `~/.phax/config.json` and `phax.local.json` and spawn the provider. Spec authoring prompts are unchanged.
- **The skill:** `.claude/skills/phax-planning/SKILL.md`, its architecture paragraph written by plan 1, and every bundled or installed copy kept in step (`src/domain/skills/catalog.ts`, the skills test that today asserts the skill does not mention `phax architecture`).
- **Usage spec and CLI reference:** how `phax --usage` and `docs:cli` are generated. Run `gen:usage-spec` before `docs:cli`.

Points the spec leaves to planning, settled in the plan's Technical arbitrations:
1. The provider's time limit: reuse the brief's fixed 60 s unless the code shows a reason not to. It is not a config key.
2. How the headless session's grant is expressed: a narrow `phax architecture` allowance, present only when a provider is configured (§8: with no key, the agent commands are the same as before). Also, what the session's read jail must admit.
3. The exact wording of the no-provider line, the failure lines, the two prompt statements and the skill's new text, following §6.
4. How a path given relative to the current directory is resolved against the working-tree root and refused when it leaves it (§5.20, §5.21). This is a pure function over the cwd and the root.

Constraints:
- **Layers** as in CLAUDE.md. Building the request, resolving the paths and choosing the prompt statement are pure domain. The provider is spawned through the Shell port, and its config is read through the existing loader. The report is decoded through a schema at the boundary. The CLI command holds no logic.
- **Formats:** no back-compat shims. Every key is required and unknown keys are refused. `files` is null or a non-empty list, with no third form.
- **Autonomy:** a missing or failing provider never stops authoring or a phase.
- **Fixtures** are made up (`acme-guard`, `acme-billing`, `src/core/billing/totals.ts`). None comes from this repository's own plans, specs or run folders, from `~/.phax` or from another repository.
- **Tests** never read `~/.phax`. They assert `$schema` URLs by format id and release pattern, never by the running version.
- **Gates:** every phase is verified by the `standard` gate profile, and every command it runs must be allowed by `phax.json`.
- **Models:** phases name only models in the installed phax's catalog. Follow the phax-planning skill's model policy: `claude-sonnet-5-5` at `medium` by default, with a `modelReason` for every departure.
- **Lint:** the plan must pass `phax plans lint`.

Docs:
- the §11 page, `docs/architecture-provider.md` or a name matching the existing provider pages, routed in `site/pages.ts` and listed in `site/build/sources.ts`;
- the skill's architecture paragraph (§5.17);
- the regenerated usage spec and CLI reference;
- `NEXT_STEPS.md`: mark planning-skill-defaults done, since this plan completes the spec.

Phase shape: as few phases as the gates allow, from the core outwards, every commit green. A likely split, merged if the gates allow:
1. The config key, the two formats, the pure request and path logic, and the `phax architecture` command with the phase guard entry.
2. The headless prompt statements and the session's grant, the skill paragraph, the docs page and NEXT_STEPS.

Output: your final message is the plan document JSON and nothing else — no sentence before or after it, no code fence.
