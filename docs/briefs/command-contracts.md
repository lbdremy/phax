Write the phax spec "Command contracts". phax's commands are written against a small command library, ported into phax, that puts each command under contracts — what it reads, what it answers, how it fails — and forces a machine answer: with `--json`, every command writes its output contract's JSON on stdout and its errors as JSON on stderr. Commander stays underneath, as the parser the runner uses; no command touches it again. This spec ports the library and moves every phax command onto it; among them, the three the brief `claude-code-mod` needs are set straight first.

**Why.** The operator, 2026-10-30. phax's commands are Commander commands, each printing what it chooses: 9 of the 65 commands of `phax.usage.kdl` have `--json`, and some of those print an unversioned document (`plans lint`, `plans overview`), and `artifact status` has none. An agent reading phax, or the Claude Code mod, cannot rely on a machine answer. The library the operator wrote outside this repository gives every command one contract, and will be published as a package; until then phax ports it, and replaces the port with the package when phax moves to Effect 4. The operator, its author, brings it under phax's Apache-2.0 licence; the package is published under MIT or Apache-2.0.

**The library (TypeScript; Effect 4 where it was written).** About 120 lines of contract and 350 of runner:
- **A command** declares a `name`, a `summary`, its sources (`args`, positional and typed by position; `flags`; `stdin`, one JSON document; `env`), each an Effect Schema with its policy for what it does not declare (`reject` refuses the call, `strip` drops it); an `output` contract and its policy; an exit code for each tagged error its `run` may fail with (the type asks for every tag and no other); a `run`, the decoded input in, an Effect out; a `render`, pure, the output and the terminal in, text out.
- **A program** names its commands and its runner's two codes: `refused` (an unknown command, an undeclared argument or option, a source that does not decode) and `defect` (what no command declared). A command may answer with `refused`, never with `defect`, and a program where they collide is refused before anything runs.
- **The process is data** (`Io`: argv, stdin read only when declared, env, the terminal, `out`, `err`), so a runner is proved without one; a conformance suite proves any runner against the contract.
- **The runner** decodes each declared source with its contract and its policy, runs the command, encodes the value with the output contract (an output that does not encode is a defect), renders it, and maps each failure to its code. The one runner built so far uses Commander for the command line.

**Settled by the operator (do not reopen):**
1. **Ported, not depended on.** The library is ported to Effect 3 into one internal module of phax (its place and name are the spec's), with its conformance suite, and changed in phax only where Effect 3 asks. phax's own commands import it, never Commander. When phax moves to Effect 4, the published package replaces the port; that is a later spec.
2. **A machine answer, forced.** These rules come with the port, and the spec states them as the library's:
   - a command that writes to stdout declares its output contract; `render` is optional, the human view drawn from it; a command with no render prints its output's JSON;
   - `--json` is the runner's, reserved: a command cannot declare it. It writes the output's encoded form, never `render`'s text. An explicit flag, not a switch on the terminal ([clig.dev](https://clig.dev/));
   - under `--json`, errors and refusals are JSON on stderr: the error's tag and fields; a refusal's source and the path of the field that failed with what was expected. Exit codes unchanged;
   - a document carries `$schema` first, the output's as the input's; the output contracts are where phax's published JSON Schemas come from (`packages/schemas`), and a command's contracts can be printed, as `phax artifact schema verdicts` prints one today;
   - a document comes in through stdin or a file by the runner: `-` for stdin, a path for a file, refused at once when stdin is a terminal and no path is given, never waiting. Arguments and options say what the command acts on; the document is its content;
   - **the files a command writes are part of its output**: each with its path from the repository's root, its format (`$schema`) and its digest (`sha256:<hex>`), never its content again; a command that writes one document takes `--out <path|->`, `-` sending the document to stdout; a command that fails part way names what it already wrote.
3. **Every command moves.** All of phax's commands are registered through the runner in this spec, so `--json` means the same on every command once it ships; the plan orders them by family. The three the brief `claude-code-mod` reads come first:
   - `phax artifact status` gains `--json`: a versioned `artifact-status` document — kind, status, legal transitions, approval and approver, edited since approval, authoring mode and sidecar sync, the questions open and arbitrated;
   - `phax plans overview --json` becomes a versioned `plan-overview` document, `$schema` first; `phax plans lint --json` too;
   - `phax runs list --json` keeps its `run-list` document, adding each run's pull request when phax opened one.
   Each keeps its text output for a person, now its `render`.
4. **The contracts phax publishes do not change** except where a document gains `$schema` or a field above: a document that is versioned today stays byte for byte. `phax --usage` stays the contract of the command line: what a migrated command declares there does not change.
5. **The codes phax documents stay.** The program's `refused` and `defect` are phax's own (the spec names them from `phax --usage`), and each command keeps the codes its help documents.
6. **A command that prints a `--json` today** keeps its document: the runner's `--json` writes that document as the command's output contract, byte for byte where it is versioned.

**Leave §9 to one question,** framed by what it abandons:
- **Q1, where `phax.usage.kdl` comes from.** Today it is generated from Commander's commands (`scripts/generate-usage-spec.ts`, `src/cli/introspect.ts`, a parity gate). Either the runner keeps building Commander commands and the generation stays as it is — the operator's lean, if it holds once every command goes through the runner; or the program writes the usage spec from its contracts, as the library's Rust twin does through clap_usage, and introspection of Commander goes. The spec checks which is possible before recommending.

**What exists (read it first):**
- `src/cli/program.ts`, `src/cli/main.ts`, `src/cli/commands/`, `src/cli/introspect.ts`, `src/cli/cliDocs.ts`, `scripts/generate-usage-spec.ts`;
- every command under `src/cli/commands/` and its tests, `artifact status`, `plans overview`, `plans lint` and `runs list` first;
- `packages/schemas/` (how a schema is exported with `JSONSchema.make`, versioned and published), `src/schemas/`;
- the brief `claude-code-mod`, whose prerequisite this spec is: what the mod reads comes from here;
- the library's source, which the operator provides at planning time.

**Out of scope:**
- phax's move to Effect 4 and the replacement of the port by the published package;
- the Claude Code mod itself;
- a flag that only validates the input and stops — an idea, wanted by agents before a command that writes.

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at 0.32.0.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
