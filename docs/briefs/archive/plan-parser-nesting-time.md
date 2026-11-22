Write the phax spec `plan-parser-nesting-time`: reading a plan takes time linear in its size, whatever its
Markdown nests, or phax refuses the plan before it parses it, naming why.

## Why

The daily deep pass of the property tests has been red since 2026-11-18 for a real defect, not a flake. Security
run 44320960144 (seed 1253054900) failed the plan parser's bounded-time property on a `character-run` fragment of
61,440 `>` characters: `collectPlanStructureErrors` used 4.5 s of CPU on the CI runner, over the property's 2 s
bound. It fails on a laptop too, so a slower runner is not the cause.

The time grows faster than the input. Measured on 2026-11-19 (Apple M4 Pro, CPU time):

| `>` characters | `collectPlanStructureErrors` | `fromMarkdown` alone |
| --- | --- | --- |
| 7,680 | 38 ms | 51 ms |
| 15,360 | 115 ms | 60 ms |
| 30,720 | 252 ms | 289 ms |
| 61,440 | 3,395 ms | — |

A run of `>` is a blockquote nested once per character. Most of the time is spent inside
`mdast-util-from-markdown` (micromark) building that nesting, before phax's own code reads the tree. Nested lists
over 60 KiB sit close to the bound as well: about 2 s of CPU per call on a slow runner (#246, which brought the
unit tier's run count down for this property but left the bound, the inputs and the deep pass as they were).

Who it reaches: every command that reads a plan, run, plans lint, plans overview, artifact approve and the
extraction. A plan comes from the operator's own repository, so this is a slowdown an odd or hostile plan can
cause, not a way in. A plan written by a headless planner or pasted from elsewhere can still carry one, and a
command that takes seconds to refuse a plan is a bad answer.

## What phax has today, to read first

- `src/domain/plan/parsePlanMarkdown.ts`: `collectPlanStructureErrors`, `readPlanDeterministic`,
  `extractPlanDeterministic`, and the two `fromMarkdown` calls.
- `tests/unit/property/planParser.property.test.ts`: the totality and bounded-time properties, `TIME_BOUND_MS`, the
  fastest-of-three CPU timing (#238), the 64 KiB input cap; `tests/helpers/property/planText.ts`: the fragments,
  `character-run` among them.
- `docs/property-tests.md` and the property-tests spec (§5.18, the run counts; the deep pass in `security.yml`).
- `docs/specs/archive/` for the plan-parser specs, and how `phax plans lint` reports a structure error.

## What to decide

- **Where the bound is enforced.** A guard before parsing (a maximum nesting depth of blockquotes and lists, a
  maximum size, or both) that refuses the plan with a structure error naming the line and the limit; or a parser
  whose cost is linear by construction (a different micromark configuration, a pre-pass that flattens what phax
  never reads); or an upstream fix in micromark, with phax pinning the version that has it. Each abandons
  something: the guard refuses plans no human writes but a fuzzer does; a parser change touches every plan read;
  upstream depends on a release phax does not control.
- **The limits, if a guard.** Values a real plan never reaches, with the margin stated; whether they are
  configurable (indicatively not).
- **What the property then proves.** The bounded-time property keeps its 2 s bound and its large inputs, and the
  deep pass goes green on seed 1253054900 and on nested lists over 60 KiB on a slow runner.
- **An upstream report.** Whether to report the nesting cost to micromark, with a minimal reproduction, whatever
  phax does locally.

## Constraints

- A plan that reads today reads the same tomorrow, unless it crosses a limit no real plan reaches; say how that was
  checked (every plan under `docs/plans/`, archive included).
- Refusals follow phax's own refusal model and come before any write.
- No test measures wall-clock time; CPU time or counted work only.
