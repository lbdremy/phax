# Usage-Based CLI Help, Documentation, and Completions

Status: Draft specification  

Date: 2026-06-15  

Project: PHAX / Phase CLI  

Type: Functional specification  

Audience: implementation planning agent

## Context

PHAX currently uses Commander.js as its CLI framework. The CLI is becoming more important as the product now includes several commands and command families: `init`, `run`, `resume`, `open`, `ls`, session-related commands, enter-related commands, and options such as delayed execution with `--startAfter`.

The current risk is not only technical. It is a product risk: if the CLI grows while help text, completions, README documentation, and command behavior drift apart, PHAX becomes harder to learn, harder to document, and harder to operate safely.

The `usage` project provides a CLI specification format and tooling for CLIs. It can define commands, flags, arguments, environment variables, config files, examples, and metadata in a single spec. That spec can then be used to generate shell completions, markdown documentation, manpages, JSON output, and potentially SDKs.

The purpose of this work is to integrate Usage into PHAX so that the PHAX CLI becomes easier to understand, easier to document, easier to complete in shells, and less likely to drift from its documentation.

## Product goal

PHAX must expose a clear, accessible, and consistently documented command-line interface.

A user should be able to:

- discover available PHAX commands from `phax --help`;
- understand each command from `phax <command> --help`;
- install or generate shell completions;
- read generated CLI documentation that stays synchronized with the executable CLI;
- rely on stable examples for the main workflows;
- trust that the README, generated docs, and runtime CLI do not contradict each other.

## Functional scope

This specification covers Usage integration for CLI discoverability, help output, shell completions, generated documentation, and CLI contract validation.

It does not define the internal implementation plan. The implementation planner should decide how to integrate Usage with the existing Commander.js codebase while preserving the functional behavior described here.

## Non-goals

This work must not become a full CLI rewrite.

The following are explicitly out of scope for the first implementation:

- replacing Commander.js entirely;
- redesigning the PHAX command model;
- changing the semantics of existing commands;
- introducing a new scripting runtime around Usage shebang scripts;
- generating public SDKs for PHAX;
- building hosted documentation;
- changing PHAX configuration semantics beyond documenting them in the Usage spec.

## Core decision

PHAX should treat Usage as the explicit CLI interface contract.

Commander.js may remain the runtime command router and executor, but Usage must become the canonical contract for:

- command names;
- aliases;
- arguments;
- flags;
- global flags;
- help text;
- long help text;
- examples;
- config and environment variable references where relevant;
- shell completion definitions;
- generated markdown documentation;
- generated manpage documentation if enabled.

The implementation may choose one of two acceptable models:

1. generate or derive the Usage spec from the existing Commander.js definitions, if the Commander integration is mature enough;
2. maintain a dedicated `phax.usage.kdl` file as the canonical CLI spec, with automated parity checks against Commander.

The functional requirement is not the internal direction. The functional requirement is that PHAX has one explicit, validated CLI contract and that runtime help/docs/completions do not drift from it.

## Required user-facing behavior

### Global help

`phax --help` must show:

- a short description of PHAX;
- the installed PHAX version;
- the main command groups;
- global flags;
- a small number of high-value examples;
- a pointer to generated CLI documentation when relevant.

The help output must be readable in a terminal. It should avoid dense paragraphs and should not assume the user already understands PHAX internals.

### Command help

Every public command must support:

```bash
phax <command> --help
```

For nested commands, help must also work at each level:

```bash
phax session --help
phax session last --help
phax enter --help
phax enter last --help
```

Each command help page must include:

- one-sentence purpose;
- argument list;
- flag list;
- defaults where meaningful;
- examples;
- warnings for commands that affect worktrees, sessions, scheduled runs, or files.

### Usage contract output

PHAX should expose a machine-readable or tool-consumable Usage contract.

Preferred behavior:

```bash
phax --usage
```

This command must print the current PHAX Usage spec to stdout and exit with code `0`.

The output must represent the installed version of PHAX, not a remote or stale spec.

If JSON output is supported, it should be explicit:

```bash
phax --usage --usage-format json
```

or by another clear equivalent chosen during implementation.

### Shell completions

PHAX must provide a documented way to generate shell completions from the Usage spec.

At minimum, the documentation must cover:

- zsh;
- bash;
- fish.

If Usage support is available and reliable, PHAX should also support:

- PowerShell;
- nushell.

Recommended public command shape:

```bash
phax completions <shell>
```

where `<shell>` is constrained to supported values.

The output should be a shell completion script written to stdout, so users can redirect it to the correct shell location.

Examples:

```bash
phax completions zsh > ~/.zsh_completions/_phax
phax completions bash > ~/.bash_completions/phax.bash
phax completions fish > ~/.config/fish/completions/phax.fish
```

If generated Usage completion scripts require the `usage` CLI to be installed on the user's machine, PHAX documentation must state that explicitly. The command should either:

- fail with a clear actionable error if `usage` is missing; or
- generate completions that do not require a runtime Usage dependency.

The implementation planner must decide which behavior is more practical, but the final UX must be explicit.

### Generated markdown documentation

PHAX must generate markdown documentation from the Usage contract.

Required outputs:

- a CLI command reference page in the repository documentation;
- an injected or generated README section for the main commands;
- examples for the primary workflows.

The generated markdown must be reproducible. Running the documentation generation command twice without changing the CLI contract should produce no diff.

Recommended internal command:

```bash
pnpm docs:cli
```

The exact script name may vary, but it must be documented.

### Manpage generation

PHAX should support manpage generation if it is low-cost once the Usage spec exists.

Recommended output:

```bash
man phax
```

or a generated `phax.1` file in the package or release artifacts.

This is optional for the first iteration, but the Usage spec must be structured so manpage generation remains possible later.

### Validation and linting

The Usage spec must be validated in CI.

Required checks:

- the Usage spec parses successfully;
- Usage linting passes;
- warnings are treated as errors once the first stable spec is accepted;
- generated docs are up to date;
- generated completions can be produced for supported shells;
- every public Commander command has a matching Usage command;
- every public Usage command has a runtime implementation;
- every public flag in Commander is represented in Usage;
- every documented example either runs in a safe test mode or is covered by a snapshot-style validation.

## Command coverage requirements

The Usage spec must cover all public PHAX commands.

At minimum, the first version must cover:

- `phax init`;
- `phax run`;
- `phax resume`;
- `phax open`;
- `phax ls`;
- `phax enter`;
- `phax enter last`;
- `phax session`;
- `phax session last`;
- `phax completions`, if added;
- `phax --version`;
- `phax --help`;
- `phax --usage`, if added.

The implementation planner must verify the actual command list from the current codebase and update this list accordingly.

## Required command documentation details

### `phax init`

The Usage spec must document:

- what file is created;
- whether existing config is overwritten;
- whether there is a `--force` flag;
- whether the generated config includes a local JSON schema reference;
- what the user should do after initialization.

Examples should include:

```bash
phax init
phax init --force
```

### `phax run`

The Usage spec must document:

- expected input plan file or default discovery behavior;
- scheduled start behavior if `--startAfter` is present;
- readable duration formats such as `5h`, `300m`, and `30s` if supported;
- interaction with macOS `caffeinate -ims` if relevant;
- what happens when gates pass;
- what happens when gates fail;
- how the user resumes the last active session.

Examples should include:

```bash
phax run plan.md
phax run plan.md --startAfter 5h
```

### `phax resume`

The Usage spec must document:

- the shortname argument;
- whether the command resumes the last active session for a running plan;
- what happens if the shortname is ambiguous or missing;
- what happens if no resumable session exists.

Examples should include:

```bash
phax resume my-plan
```

### `phax open`

The Usage spec must document:

- the shortname argument;
- that it opens the terminal or working directory for the corresponding worktree;
- what happens if the worktree no longer exists.

Examples should include:

```bash
phax open my-plan
```

### `phax ls`

The Usage spec must document:

- what plans are listed;
- which statuses exist;
- whether completed and archived plans are shown by default;
- any flags that filter running, completed, archived, or failed plans.

Examples should include:

```bash
phax ls
phax ls --all
```

### Session and enter commands

The Usage spec must document the distinction between:

- entering a command session;
- entering the last session;
- selecting a model-specific session;
- reusing the model locked for the phase;
- falling back when session metadata is incomplete.

This is important because PHAX must not accidentally route a resumed phase to a different model from the model that executed that phase.

## Accessibility requirements

The CLI help and generated docs must be written for a user who is competent with developer tools but new to PHAX.

The help system must avoid:

- unexplained internal vocabulary;
- hidden assumptions about worktrees, gates, or agent sessions;
- examples that require prior context;
- overly terse descriptions such as `Run plan` when the command has important side effects.

The help system must prefer:

- short purpose statements;
- concrete examples;
- stable terminology;
- explicit side effects;
- clear error recovery paths.

## Error message requirements

Usage integration should improve error discoverability.

When a user provides an invalid command, invalid flag, missing argument, or invalid choice, PHAX should show:

- what was invalid;
- the closest valid command or flag when available;
- the relevant help command;
- no stack trace by default.

Examples:

```
Unknown command: phax resum
Did you mean: phax resume?
Run `phax resume --help` for usage.
```

```
Invalid value for --startAfter: "tomorrowish"
Expected a duration such as 5h, 300m, or 30s.
Run `phax run --help` for usage.
```

## Documentation generation requirements

The generated CLI docs must include:

- command synopsis;
- arguments;
- flags;
- default values;
- examples;
- notes about side effects;
- config and environment variables where relevant.

The generated docs should be committed to the repository unless the project already has a strict generated-docs policy.

The README should include only the most important command summary. Full command details should live in generated CLI docs.

## Packaging requirements

The PHAX npm package must include the Usage spec or a way to emit it from the installed binary.

This matters because users should get documentation and completions for the PHAX version they installed, not for the latest source version on GitHub.

The release process must verify that:

- the package contains the Usage contract;
- `phax --usage` works after package installation;
- completion generation works from the installed package;
- generated docs match the released command surface.

## Versioning requirements

The Usage spec must include PHAX metadata:

- CLI name;
- binary name;
- version;
- license if applicable;
- author or project name if applicable;
- minimum supported Usage version.

When PHAX changes command behavior, the Usage spec must be updated in the same pull request.

A command change without a Usage spec update should fail CI.

## Functional acceptance criteria

The feature is complete when:

1. `phax --help` gives a clear overview of the CLI.
2. Every public command has useful `--help` output.
3. The Usage contract exists and is shipped with PHAX.
4. The Usage contract covers all public commands and flags.
5. The Usage contract can be linted in CI.
6. Markdown CLI docs can be generated from the Usage contract.
7. Generated docs are checked for drift in CI.
8. Shell completions can be generated for at least zsh, bash, and fish.
9. Completion generation behavior clearly states whether the external `usage` CLI is required.
10. The PHAX npm package contains enough metadata for users to generate docs/completions for their installed version.
11. Existing command behavior remains unchanged unless explicitly specified in a separate command behavior spec.
12. Invalid command and invalid flag errors are readable and point users to the relevant help command.

## Suggested implementation phases for planning

This section is guidance for the implementation planning agent, not a mandatory implementation plan.

### Phase 1 — Inventory current CLI surface

Extract the current Commander command tree, including commands, aliases, arguments, flags, defaults, and descriptions.

Produce a comparison table of current runtime behavior versus intended Usage contract.

### Phase 2 — Create initial Usage contract

Create the first PHAX Usage spec covering all current public commands.

Add examples and long help for the commands that need context: `run`, `resume`, `init`, session commands, and delayed execution.

### Phase 3 — Wire help and Usage output

Expose the Usage contract through PHAX, preferably with `phax --usage`.

Decide whether runtime help is generated directly from Usage or whether Commander help is synchronized from the same metadata.

### Phase 4 — Add docs generation

Generate markdown docs from the Usage contract.

Add a repeatable repository script and a CI drift check.

### Phase 5 — Add completions

Add shell completion generation for supported shells.

Document installation commands for zsh, bash, and fish.

### Phase 6 — Add validation gates

Add Usage linting and Commander/Usage parity checks.

Fail CI when the executable CLI and Usage contract drift.

## Open questions for implementation planning

- Is the Commander.js Usage adapter mature enough to derive the Usage spec from existing Commander definitions?
- Should `phax --usage` output KDL only, or should it also support JSON?
- Should `phax completions <shell>` require the external `usage` CLI at runtime, or should PHAX generate static completions without that user dependency?
- Which command names are final: `Phase`, `PHAX`, `phax`, and any remaining `phase` aliases?
- Which command families should be treated as public and documented, and which are internal or experimental?

## Source notes

- Usage home: [https://usage.jdx.dev/](https://usage.jdx.dev/)
- Usage specification: [https://usage.jdx.dev/spec/](https://usage.jdx.dev/spec/)
- Usage CLI installation: [https://usage.jdx.dev/cli/](https://usage.jdx.dev/cli/)
- Completion generation: [https://usage.jdx.dev/cli/completions](https://usage.jdx.dev/cli/completions)
- Markdown generation: [https://usage.jdx.dev/cli/markdown](https://usage.jdx.dev/cli/markdown)
- Lint command: [https://usage.jdx.dev/cli/reference/lint](https://usage.jdx.dev/cli/reference/lint)
- Manpage generation: [https://usage.jdx.dev/cli/reference/generate/manpage](https://usage.jdx.dev/cli/reference/generate/manpage)
