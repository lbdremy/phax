# Plan extraction model configuration

## Where the model is configured

Plan extraction runs inside `phax run` (and `plans status` / `plans overlap`) as the
fallback used when the deterministic parser cannot extract a plan on its own. There is
no CLI flag for it; the model and effort resolve through a two-level precedence chain:

1. **`phax.json`** — `agent.extractPlan.model` / `agent.extractPlan.effort`
2. **Built-in default** — `claude-haiku-5-5` at `low` effort (lowest priority)

Example `phax.json` override:

```json
{
  "agent": {
    "backend": "claude-code-cli",
    "extractPlan": {
      "model": "claude-sonnet-5",
      "effort": "medium"
    }
  }
}
```

## Why the conservative default was chosen

The extraction task is structured and mechanical: read a Markdown document, emit JSON
conforming to a well-defined schema. A capable small model (`claude-haiku-5-5`)
handles this reliably at a fraction of the cost of Sonnet or Opus, and the low effort
level is appropriate because extraction does not require deep reasoning.

The built-in default is intentionally conservative. If extraction fails (bad JSON, schema
mismatch) the run has not yet started — no worktree, no state has been committed — so
retrying with a stronger model configured via `agent.extractPlan` is cheap. Run `phax
plans lint <plan>` first to catch structural defects without invoking a model at all.

## Test lines

The fallback emits each phase's `testLines` through the same schema as the deterministic parser, copying each line's coordinates verbatim from the plan. A plan with a test line off the format is refused before the fallback runs, naming the line and `phax plans lint`: the model is never asked to read a line phax has already found malformed.

## Local validation policy

Regardless of which model is used, the extraction fallback always validates the raw JSON
output against the `PhaxPlanSchema` locally before it is used. This means a cheaper model
that produces structurally invalid output is caught immediately rather than silently
poisoning a run later (spec §6).

The prompt forbids guessing a missing field, and `claude-haiku-5-5` holds to that more
strictly than Haiku 4.5 did. So the prompt states the fields phax derives rather than
reads (the run's title and short name both come from the `# ` heading). A model that
still finds a required field missing answers `{"error": …}`, and phax reports that
reason ("The extraction model found the plan incomplete: …") instead of a schema
mismatch.

## TODO: `assess-extract-model` command (deferred)

A future `phax assess-extract-model` command would benchmark candidate models against a
set of representative `plan.md` fixtures, report extraction accuracy and cost, and
recommend the best model/effort trade-off for the current project. This is deferred until
the `pnpm audit:architecture` engine (phax phase-14) is built.
