# CLI view layer

## The rule

**Files under `src/cli/commands/` must stay thin.** A command handler's only
jobs are:

1. Parse and decode CLI arguments into a typed command object.
2. Call one `app/` use case.
3. Render the result or error through the `OutputPort`.
4. Return the exit code.

Command handlers must not import `infra/` directly, must not contain business
logic, and must not call multiple unrelated use cases in sequence (that belongs
in `app/`).

## The output port

All printing goes through `src/ports/output.ts`:

```typescript
export interface OutputPort {
  log(message: string): void;
  error(message: string): void;
}
```

No `console.log` or `process.stdout.write` outside `cli/` or the output port
adapter. This keeps domain and app testable without capturing stdout.

## Why

Thin command handlers mean:

- The application use cases are independently testable without a CLI harness.
- Exit-code mapping lives in one place and is consistent across commands.
- The output port can be swapped for a test double that captures output.

## What "thin" means in practice

A well-formed command handler is typically 15–30 lines:

```typescript
export async function runArchive(
  shortName: string,
  opts: { force?: boolean },
  out: OutputPort,
): Promise<number> {
  const result = await archiveRun(shortName, { force: opts.force ?? false });
  if (Either.isLeft(result)) {
    out.error(result.left.message);
    return 1;
  }
  out.log(`Archived ${shortName}`);
  return 0;
}
```

If your handler contains `if/else` chains that implement business rules, move
those rules into `app/`.

## Audit rules

`PHAX_CLI_001` — `src/cli/commands/` file imports from `infra/` or contains
more than trivial logic.
`PHAX_OUTPUT_001` — `console.*` or `process.stdout.write` outside `cli/` or
the output port adapter.
