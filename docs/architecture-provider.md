# Architecture provider

A planner needs to know how a repository is built before it cuts phases: its parts, the direction of their dependencies, and the boundaries its own checks enforce. An architecture provider is a command you write that answers that question, and `phax architecture` prints its answer. This page is for the repository owner who declares one, and for the author of the provider.

## Declare a provider

Add an `architecture` key to `phax.json`, `phax.local.json` or `~/.phax/config.json`; the highest of the three layers that declares it wins:

```json
{
  "architecture": { "command": "acme-guard architecture" }
}
```

`command` is split on spaces and run without a shell. Then ask:

```bash
phax architecture
phax architecture src/core
```

The first asks about the whole repository, the second about the parts that hold `src/core`. Each prints the provider's report as Markdown: its body as is, then, when the report lists parts, a `## Parts` section with each part's name, id, description and globs (every name here is made up):

```markdown
# Architecture — acme-billing

Three layers, dependencies pointing inward: `src/cli` → `src/core/billing` → `src/core/ledger`.

- `src/core/billing/totals.ts` sums invoices and may not import from `src/cli`.
- `acme-guard check` fails the build when a lower layer imports a higher one.

## Parts

### core · billing (`core-billing`)
Invoice totals and their rules.
- `src/core/billing/**`
```

Paths resolve against the current directory, may not exist yet, and must lie inside the working tree. `phax architecture .` is refused as the tree itself: asking with no path is the one way to ask about the whole repository. The provider runs from the working tree's root, with no shell and a fixed 60-second limit.

## The request

phax writes one request on the provider's stdin. For the whole repository, `files` is `null`:

```json
{ "$schema": "https://docs.phax.run/schemas/architecture-request/0.26.0.json", "files": null }
```

With paths, `files` holds them relative to the working tree's root, deduplicated, in the order given:

```json
{
  "$schema": "https://docs.phax.run/schemas/architecture-request/0.26.0.json",
  "files": ["src/core/billing/totals.ts", "src/core"]
}
```

Replay a request against your provider:

```bash
echo '{"$schema":"https://docs.phax.run/schemas/architecture-request/0.26.0.json","files":null}' | acme-guard architecture
```

## The report

The provider answers JSON on stdout: a `$schema`, a Markdown `body` and the `parts` of the code the report describes. All three are required and every other key is refused:

```json
{
  "$schema": "https://docs.phax.run/schemas/architecture-report/0.26.0.json",
  "body": "# Architecture — acme-billing\n\nThree layers, dependencies pointing inward.",
  "parts": [
    {
      "id": "core-decide",
      "name": "core · decide",
      "description": "The pure decision logic: no I/O.",
      "globs": ["src/core/decide/**"]
    },
    {
      "id": "http-requests",
      "name": "http · requests",
      "description": "Request handlers and their schemas.",
      "globs": ["src/http/**", "src/*/schemas/**"]
    },
    {
      "id": "docs",
      "name": "docs",
      "description": "The documentation.",
      "globs": ["docs/**", "*.md"]
    }
  ]
}
```

`parts` may be empty. Each part carries exactly `id`, `name`, `description` and `globs`; no model or effort appears anywhere in the report.

- `id` is a kebab-case slug (`core-decide`), unique within the report. It is the stable name a bound in `phax.json` will give the part.
- `name` is shown to the agent and never interpreted by phax. `description` is one sentence on what the part holds.
- `globs` is a non-empty list. Globs are working-tree-root-relative POSIX paths, matched case-sensitively and the same on every host. `**` as a whole segment matches zero or more segments, `*` matches zero or more characters within a segment, and `?` matches one character other than `/`. A leading dot is not special, so `docs/**` covers `docs/.vitepress/config.ts`. Every other character is literal, `[`, `]` and `!` included. A glob covers files: write `src/core/**` to cover a directory, and `docs/**` and `*.md` as two globs, since braces are refused. A glob that is empty, starts with `/`, contains a backslash, has an empty, `.` or `..` segment (a trailing `/` included) or uses `**` inside a segment (`src/**.ts`) is refused.

`phax architecture` prints the body as is, then each part in the report's order:

```markdown
# Architecture — acme-billing

Three layers, dependencies pointing inward.

## Parts

### core · decide (`core-decide`)
The pure decision logic: no I/O.
- `src/core/decide/**`

### http · requests (`http-requests`)
Request handlers and their schemas.
- `src/http/**`
- `src/*/schemas/**`

### docs (`docs`)
The documentation.
- `docs/**`
- `*.md`
```

With paths, the provider answers for those paths and phax renders whatever parts it returns.

`$schema` names the `architecture-report` shape the report is written in: the release that last changed the format. A report without `$schema`, naming another format, stamped newer than the running phax or in an older shape is refused by name, and the refusal names the URL phax reads. Restamp the report whenever a release changes the shape.

A provider that declines to answer exits non-zero, with its reason on stderr.

## No provider

Remove the key and `phax architecture` prints one line on stdout and exits 1:

```text
No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.
```

The line is meant for the agent: it reads the code and its documentation, and carries on.

When `phax.json` declares [assignment bounds](assignment-bounds.md), the line is followed by a blank line and the bounds, a part bound marked `(unresolved: no architecture provider)`, and the exit is still 1.

## Assignment bounds

When `phax.json` declares `assignments`, `phax architecture` prints a `## Bounds` section after the parts, one `assignments[N]` line per bound in list order. A part bound shows the name and globs of the part whose `id` it names, so **a part's `id` is the name a bound uses**: renaming an id in your report breaks the bounds that name it, and `phax plans lint` reports each one as unresolved. A path-scoped call that does not carry a bound's part marks it ``(not in this report: run `phax architecture` with no path for its globs)``; a whole-repository report that lacks the part marks it `(unresolved: the report has no part <id>)`. A provider that fails prints its one stderr line and no bounds. See [Assignment bounds](assignment-bounds.md).

`phax plans lint` and the start of `phax run` and `phax resume` also run the provider, once per call, to resolve part bounds; they do so only when at least one bound names a part.

## When it fails

A provider that exits non-zero, runs past the limit, prints something that is not JSON or prints a refused report fails with one line on stderr and exit 1. The provider's stderr is folded onto one line.

```text
✗ architecture provider exited with code 3: acme-guard: no ledger found
✗ architecture provider timed out after 60000ms: acme-guard architecture
✗ architecture provider: parts: is missing; this phax reads https://docs.phax.run/schemas/architecture-report/0.26.0.json
✗ phax architecture: ../elsewhere is outside the working tree
```

## In a phase worktree

`phax architecture` is allowed inside a phase worktree, where phax refuses every other command except `phax brief` and the read-only ones. The config comes from the repository's main checkout. The command writes no file and no record, inside a worktree or outside one.

## In headless plan authoring

`phax artifact new plan --headless` tells the planner whether a provider is configured. With one, the prompt asks it to run `phax architecture`, or `phax architecture <path>...` for the parts the plan touches, before cutting phases, and the session may run that command. On Claude Code the session is read-only: it keeps its reading tools, cannot write a file, and runs no other command. Mistral Vibe is read-only too: it keeps `read_file` and `grep`, and runs `phax architecture` through a bash allowlist. Codex does not restrict a session's commands, so there the grant changes nothing. When bounds are declared, the prompt adds that the command lists them after the parts, and asks the planner to assign each phase against them. With bounds and no provider, the prompt still sends the planner to the command, which exits 1 with its no-provider line and then lists the bounds, and the session is granted it all the same. With neither, the prompt tells it not to run the command and to read the code and its documentation. The prompt lists no bound. Spec authoring is unchanged.

The session runs under limits your provider must live with:

- It must not count on writing a cache. On Claude Code the session writes nothing, and on Codex it writes only `.phax-context/`.
- The network is provider-only. A provider must not count on reaching the network.
- On Codex, a provider that writes outside its writable roots or reaches the network fails, as one line, and the planner falls back to the code. On Claude Code the command itself is not sandboxed. The planner cannot change which provider it runs, because it cannot edit `phax.json` or `phax.local.json`, so nothing beyond the provider's own code holds its process.

A provider that needs more than this should answer from files it can read, and decline with a non-zero exit when it cannot.
