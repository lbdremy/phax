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

The first asks about the whole repository, the second about the parts that hold `src/core`. Each prints the provider's Markdown body as is (every name here is made up):

```markdown
# Architecture — acme-billing

Three layers, dependencies pointing inward: `src/cli` → `src/core/billing` → `src/core/ledger`.

- `src/core/billing/totals.ts` sums invoices and may not import from `src/cli`.
- `acme-guard check` fails the build when a lower layer imports a higher one.
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

The provider answers JSON on stdout. The minimal report is a `$schema` and a Markdown `body`; every other key is refused:

```json
{
  "$schema": "https://docs.phax.run/schemas/architecture-report/0.26.0.json",
  "body": "# Architecture — acme-billing\n\nThree layers, dependencies pointing inward."
}
```

`$schema` names the `architecture-report` shape the report is written in: the release that last changed the format. A report without `$schema`, naming another format, stamped newer than the running phax or in an older shape is refused by name, and the refusal names the URL phax reads. Restamp the report whenever a release changes the shape.

A provider that declines to answer exits non-zero, with its reason on stderr.

## No provider

Remove the key and `phax architecture` prints one line on stdout and exits 1:

```text
No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.
```

The line is meant for the agent: it reads the code and its documentation, and carries on.

## When it fails

A provider that exits non-zero, runs past the limit, prints something that is not JSON or prints a refused report fails with one line on stderr and exit 1. The provider's stderr is folded onto one line.

```text
✗ architecture provider exited with code 3: acme-guard: no ledger found
✗ architecture provider timed out after 60000ms: acme-guard architecture
✗ phax architecture: ../elsewhere is outside the working tree
```

## In a phase worktree

`phax architecture` is allowed inside a phase worktree, where phax refuses every other command except `phax brief` and the read-only ones. The config comes from the repository's main checkout. The command writes no file and no record, inside a worktree or outside one.

## In headless plan authoring

`phax artifact new plan --headless` tells the planner whether a provider is configured. With one, the prompt asks it to run `phax architecture`, or `phax architecture <path>...` for the parts the plan touches, before cutting phases, and the session is granted that one command and nothing else. With none, the prompt tells it not to run the command and to read the code and its documentation. Spec authoring is unchanged.

The session runs under limits your provider must live with:

- It may write only `.phax-context/`. A provider must not count on writing a cache elsewhere.
- The network is provider-only. A provider must not count on reaching the network.
- On Codex, a provider that writes outside its writable roots or reaches the network fails, as one line, and the planner falls back to the code. On Claude Code a granted command is not sandboxed, so nothing beyond the provider's own code holds its process.

A provider that needs more than this should answer from files it can read, and decline with a non-zero exit when it cannot.
