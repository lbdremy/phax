# Validation boundaries

## The rule

**Every external input must be decoded through an Effect Schema before crossing
into the domain.**

External inputs include:

- Files read from disk (`phax.json`, `phax-plan.json`, `run-status.json`,
  `registry.json`, `phase/status.json`, Claude JSONL output, git command output)
- Environment variables (`process.env.*`)
- CLI arguments (after commander parses them, decode into typed command objects)
- Any response from an external process

## Where decoding happens

Decoding belongs in `infra/` adapters or at the very start of `cli/` command
handlers, before any `app/` use case is called. The `app/` and `domain/` layers
receive already-decoded, already-validated values only.

`JSON.parse` inside `app/` or `domain/` is a violation. Read the file in
`infra/`, decode immediately, and return a typed value.

## Why

Unvalidated data reaching the domain means the domain type system can no longer
be trusted. A `RunState` that was not decoded through its schema might hold an
invalid string; a `PhaseId` built from unvalidated input might be out of range.
Effect Schema decoding at the boundary means every value inside the domain is
guaranteed valid by construction.

## How to fix a violation

1. Find the `JSON.parse` (or `readFile` with an immediate cast) in `app/` or `domain/`.
2. Move it to the appropriate `infra/` adapter.
3. Decode the raw value through the matching schema in `src/schemas/`.
4. Return the typed, decoded value across the boundary.

## Audit rule

`PHAX_VALIDATION_001` — `JSON.parse` or unguarded `readFile` caller detected
outside `infra/`.
