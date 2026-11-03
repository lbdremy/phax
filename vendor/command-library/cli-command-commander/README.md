# `@steme-lab/cli-command-commander`

The library's API as steme-corpus proposed it (its declarations, with the samples and refused cases the corpus compiled them with), taken from `02-product/steme-surface/target/typecheck/typescript/stubs/@steme-lab/cli-command-commander at 39ac70a` and moved here on 2026-10-23
from steme-lab's `docs/reference/api/typescript/cli-command-commander/`. It is where the library started: the declarations became its
code, and the samples and refused cases its tests. The library is its own source of truth; nothing holds it to
another copy.

## How it reads a call

Before `--`, every word that starts with `-` is an option, `-5` and `-` included, and never the value of the option before it: `--to -5` is refused, `--to=-5` gives `-5`. The first `--` that is not an option's value ends the options, as POSIX guideline 10 (and GNU, and clap on the Rust side) has it: it is consumed, and every word after it, a dash-word or a second `--` too, is a positional argument, under the `args` policy like any other. So options go before it: `todos rename-todo --to one -- -x` gives the positional `-x`.

## Groups and help

A group is a Commander command of its own, with its commands under it and no help command. Called alone it writes its help on stderr and is refused; `<group> --help` writes it on stdout. The names, helps, choices and defaults that Commander's `--help` shows are read from the contracts and only shown: Commander enforces none of them, the contract's decode does.

## Where things are

- The code is under `src/`: the entry `src/index.ts` (which exports `runner` and `processIo`), the runner in `src/internal/`, and Commander and the process in `src/adapters/`.
- `edge.ts` and `refused.ts` are its compiled samples: the whole example's edge replayed, and four calls the compiler refuses. They are compiled and never loaded.
- Its tests are under `tests/`. They run the contract's sample commands by path and hold the runner to `@steme-lab/cli-command/conformance`.
