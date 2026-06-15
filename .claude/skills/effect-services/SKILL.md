---
name: effect-services
description: Route all side-effecting operations (filesystem, shell, git, clock) through port interfaces in src/ports/ using Effect dependency injection.
---

# Effect services

## The rule

**Direct access to the filesystem, shell, git, Claude, editor, clock, or
`process.env` is only allowed inside `src/infra/` adapters.** All other layers
must go through the port interfaces using Effect's dependency injection.

## How ports are consumed in app/

```typescript
import { FileSystem } from "../../ports/fs.js";
import { Effect } from "effect";

export const createRunFolder = (shortName: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem; // injected — no concrete adapter here
    yield* fs.mkdirp(runPath);
    yield* fs.writeAtomic(statusPath, JSON.stringify(initialStatus));
  });
```

The concrete adapter (`NodeFileSystem`) is provided at the composition root in
`cli/main.ts` or in test helpers.

## Why

Infrastructure access outside `infra/` means:

- Tests cannot swap in fakes without patching globals.
- The adapter cannot be replaced (e.g., swapping git for a different VCS
  backend) without touching every call-site.
- Side-effecting code is hidden inside layers that should be pure.

## Common violations and fixes

| Violation                      | Fix                                                     |
| ------------------------------ | ------------------------------------------------------- |
| `fs.readFileSync(…)` in `app/` | Use `FileSystem` port via `yield* FileSystem`           |
| `execSync(…)` in `domain/`     | Move to `infra/shell.ts`; expose via `Shell` port       |
| `process.env.X` in `app/`      | Read in `cli/` on startup; pass as a typed config value |
| `new Date()` in `app/`         | Use the `Clock` port (`yield* Clock`)                   |

## Audit rule

`PHAX_EFFECT_001` — direct FS/shell/git/Claude/editor/clock/`process.env`
access detected outside `infra/`.
