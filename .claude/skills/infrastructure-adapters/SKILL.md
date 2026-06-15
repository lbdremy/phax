---
name: infrastructure-adapters
description: Implement infrastructure adapters in src/infra/ behind port interfaces in src/ports/ — the only place side effects are allowed.
---

# Infrastructure adapters

## The rule

**Every infrastructure adapter must implement a port interface defined in
`src/ports/`.** Adapters live in `src/infra/` and are the only place where
side effects (filesystem, shell, git, Claude, editor, clock) are allowed.

## Port/adapter pairs

| Port (`src/ports/`)      | Adapter (`src/infra/`)            | What it wraps                                                    |
| ------------------------ | --------------------------------- | ---------------------------------------------------------------- |
| `fs.ts` (FileSystem)     | `fs.ts` (NodeFileSystem)          | `@effect/platform/FileSystem`; `writeAtomic` uses temp-rename    |
| `git.ts` (Git)           | `git.ts` (NodeGit)                | `git` CLI via `@effect/platform/Command`                         |
| `shell.ts` (Shell)       | `shell.ts` (NodeShell)            | `@effect/platform/Command`; opaque argv arrays, no interpolation |
| `backend.ts` (Backend)   | `claudeCli.ts` (ClaudeCliBackend) | `claude` CLI; streams JSONL, captures session id                 |
| `editor.ts` (Editor)     | `editor.ts` (NodeEditor)          | Configured editor command                                        |
| `lock.ts` (Lock)         | `lock.ts` (FileLock)              | Lock files under `~/.phax/locks/`                                |
| `output.ts` (OutputPort) | _(in cli/)_ `consoleOutput`       | `console.log` / `console.error`                                  |

## No shell interpolation

Shell and git adapters must never interpolate user-controlled data into a
command string. Always pass branch names, paths, and other arguments as
separate `argv` array tokens:

```typescript
// Good
Command.make("git", "worktree", "add", worktreePath, branchName);

// Bad — do not do this
Command.make("sh", "-c", `git worktree add ${worktreePath} ${branchName}`);
```

## Atomic writes

`FileSystem.writeAtomic(path, content)` writes to `<path>.tmp.<random>` in the
same directory, fsyncs, then renames. This ensures readers never see a partial
write. All status JSON files and registry updates must use `writeAtomic`.

## Fake adapters for tests

In-memory fakes for every port live in `src/infra/fakes/`. Use them in unit
and integration tests. Never use real filesystem, real git, or real `claude`
in the default test suite.

## How to write a new adapter

1. Define the port interface in `src/ports/<name>.ts` as an Effect `Context.Tag`.
2. Implement the adapter in `src/infra/<name>.ts` as a `Layer`.
3. Add a fake in `src/infra/fakes/Fake<Name>.ts` implementing the same tag.
4. Provide the real adapter layer in `cli/main.ts`; provide the fake in tests.
