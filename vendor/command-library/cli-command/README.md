# `@steme-lab/cli-command`

The library's API as steme-corpus proposed it (its declarations, with the samples and refused cases the corpus compiled them with), taken from `02-product/steme-surface/units/api/typescript/cli-command at 39ac70a` and moved here on 2026-10-23
from steme-lab's `docs/reference/api/typescript/cli-command/`. It is where the library starts: the declarations become its
code, and the samples and refused cases its tests. The library is its own source of truth; nothing holds it to
another copy.

## Groups, help and the usage spec

- `defineGroup({ name, summary, commands })` puts commands under one word, `<program> <group> <command>`; `defineProgram` takes groups beside commands. Each command keeps its own input, codes, `--json` and `--json-schema`.
- A command may carry `help` (a long help after its summary) and `examples` (command lines, one per entry).
- A positional is named by its element's `identifier` annotation (else `arg<N>`). `description` annotations are the help of an element or a field, a literal union gives the choices, and a `withDecodingDefault` gives the default. `argShapes` and `flagShapes` read them, once, for the catalogue, the usage spec and the runners' help.
- `usageSpec(program)` is the program's usage spec in KDL (clap_usage's format, which the `usage` CLI reads), written from the definitions alone. A runner answers `<program> --usage-spec` with it.

## Layout

- The library's code is under `src/`: the entry `src/index.ts` (it only re-exports), the shapes in `src/contracts/`, the implementation in `src/internal/`.
- The samples (`rename-todo.command.ts`, `program.ts`) and `refused.ts` at the folder's root are its tests. `typecheck` compiles them, and nothing loads them at run time.
- The runner's tests import `rename-todo.command.ts` by path, so moving or renaming it is a change to `libraries/typescript/cli-command-commander/` too.
