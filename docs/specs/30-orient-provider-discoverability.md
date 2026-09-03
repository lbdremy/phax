---
status: Approved
date: 2026-09-03
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Orient Provider Discoverability

## 1. Context

Spec 17 (archived) shipped the **orient** channel: an operator registers one provider command
in `phax.json`, phax asks it for an orientation **index** keyed by a phase's planned files and
weaves that index into the phase prompt, and the in-phase agent pulls more on demand with
`phax orient <id>` (a row's body) or `phax orient --file <path>` (an index for any file).

Spec 17 pinned the four-field row as normative but left the config key, the request and response
spellings, and the transport **indicative**. The implementation then fixed all of them: phax runs
the configured command with no shell, splitting the string on whitespace; it writes one JSON
object on stdin, expects exit code 0 and one JSON object on stdout, and rejects any response that
fails schema validation. Once an orient block is present, `phax orient` is added to the agent
command allowlist without an explicit grant.

Today every public surface describes only the consumer side of that contract:

- `phax --usage`, the declared source of truth for the CLI contract, carries this and nothing
  more:

      cmd "orient" {
          help "Pull orientation from the configured orient provider: expand a row by id, or pass --file to get an index for an arbitrary file"
          arg "[id]" { help "Row id to expand" }
          flag "--file" { arg "<path>" help "Return an index for an arbitrary file instead of expanding a row id" }
      }

- `phax.schema.json` types the key with no description:

      "orient": { "type": "object", "required": ["command"],
                  "properties": { "command": { "$ref": "#/$defs/NonEmptyString" } } }

- `phax orient` without configuration prints the only hint that names the key:

      No orient provider is configured. Add an `orient: { command }` block to phax.json to enable `phax orient`.

- The README command list and `docs/cli/reference.md` repeat the usage help line verbatim. The
  README's Configure section, its manual `phax.json` example, the `phax init` wizard and the
  `examples/hello-world` project never mention orient.

## 2. Problem

A developer or agent holding only the installed binary can discover that a key named
`orient.command` exists, and cannot discover what the command must do. The request shapes, the
response shapes, the exit-code rule, the no-shell tokenization and the implicit allowlist grant
live in source and in an archived spec that explicitly declined to make them binding. Setting
orient up therefore means reading phax's code, and a provider written from the archived spec
alone may be rejected at runtime for a spelling the spec called indicative.

This contradicts the project's own rule that `phax --usage` never drifts from the binary and is
the place to read the contract. Orient is the one command whose contract has a second half (the
provider side) and that half is not there.

## 3. Product goal

Make the orient provider contract readable from the phax surfaces a developer already reaches
for: `phax --usage`, the generated config schema, the command's own error output, the README and
the shipped example project. After this change, a developer can configure orient and write a
conforming provider without opening phax's source or its archived specs.

> The provider contract is part of the CLI contract: if `phax --usage` cannot tell you how to
> satisfy `phax orient`, the command is not documented.

## 4. Terminology

- **Orient provider** — the operator-supplied command phax runs to obtain orientation.
- **Index request** — the JSON phax sends to the provider to obtain rows for a set of files.
- **Expand request** — the JSON phax sends to obtain one row's full body by id.
- **Row** — one orientation entry: `id`, `title`, `severity` (`error | warn | info`), `trigger`;
  an **expanded row** additionally carries `body`.
- **Provider contract** — the union of: the config key, invocation rule, both requests, both
  responses, the exit-code rule, and the allowlist grant.
- **Usage spec** — the `phax.usage.kdl` document printed by `phax --usage`, from which the CLI
  reference and the README command list are regenerated.

## 5. Functional requirements

### 5.1 Provider contract in the usage spec

The `orient` entry of the usage spec SHALL carry a long help that states the provider contract in
full: the config key, the no-shell whitespace tokenization, the index and expand request shapes,
the index and expand response shapes including the severity set and the null-row case, the
exit-code rule, and the implicit `phax orient` allowlist grant.

### 5.2 Examples in the usage spec

The `orient` entry of the usage spec SHALL carry at least one example for expanding a row by id
and one for indexing a file.

### 5.3 Generated documentation follows the usage spec

WHEN the CLI reference and the README command list are regenerated THE system SHALL reproduce
the `orient` long help and examples in both.

### 5.4 Config schema describes the key

The generated `phax.schema.json` SHALL describe `orient.command` with a description that states
what the command is, that it is tokenized on whitespace with no shell, and where the full provider
contract is read.

### 5.5 Unconfigured invocation points at the contract

WHEN `phax orient` runs in a project with no orient block THE system SHALL name the config key and
name the usage entry where the provider contract is documented.

### 5.6 README documents orient configuration

The README Configure section SHALL document orient with a config block and the provider contract,
and SHALL link the `phax orient` reference entry.

### 5.7 Example project ships a working provider

The `examples/hello-world` project SHALL include an orient block and a dependency-free provider
script such that `phax orient --file <path>` and `phax orient <id>` return rows from it.

### 5.8 Example provider conforms to the enforced contract

IF the example provider's responses do not decode against phax's response validation THEN the
test suite SHALL fail.

## 6. Surface

### `phax --usage`, `orient` entry — before → after

Before (today):

    cmd "orient" {
        help "Pull orientation from the configured orient provider: expand a row by id, or pass --file to get an index for an arbitrary file"
        arg "[id]" { help "Row id to expand" }
        flag "--file" { arg "<path>" help "Return an index for an arbitrary file instead of expanding a row id" }
    }

After. Presence of `long_help` and `example`, and every fact the long help states, are
**normative**; the prose wording and ordering are **indicative**:

    cmd "orient" {
        help "Pull orientation from the configured orient provider: expand a row by id, or pass --file to get an index for an arbitrary file"
        long_help "Requires an orient provider in phax.json:\n\n  \"orient\": { \"command\": \"node ./scripts/orient.mjs\" }\n\nphax runs the command with no shell — the string is split on whitespace, so use a wrapper script for pipelines or paths with spaces — from the current directory (the phase worktree during a run), writes one JSON request on stdin and expects exit code 0 and one JSON response on stdout.\n\nIndex request  {\"files\": [\"src/a.ts\", \"src/b.ts\"]}\nIndex response {\"rows\": [{\"id\": \"...\", \"title\": \"...\", \"severity\": \"error\"|\"warn\"|\"info\", \"trigger\": \"...\"}]}\n\nExpand request  {\"expand\": \"<id>\"}\nExpand response {\"row\": {\"id\", \"title\", \"severity\", \"trigger\", \"body\"}} or {\"row\": null} when the id is unknown\n\nAll fields are non-empty strings. A non-zero exit, non-JSON stdout or a response that fails validation is reported as a provider error (exit 1); an empty index or a null row prints \"No orientation available.\" and exits 0.\n\nDuring a run phax sends the index request for each phase's planned files and weaves the rows into the phase prompt. When orient is configured, `phax orient` is allowed to the in-phase agent without an explicit agentCommands grant."
        example "phax orient core-no-adapters"
        example "phax orient --file src/jobs/sync.ts"
        arg "[id]" { help "Row id to expand" }
        flag "--file" { arg "<path>" help "Return an index for an arbitrary file instead of expanding a row id" }
    }

The request and response spellings above (`files`, `expand`, `rows`, `row`, `id`, `title`,
`severity`, `trigger`, `body`, the severity set, `null` for unknown id) are **normative**: they
promote the spellings spec 17 left indicative to the contract phax already enforces.

### `phax.schema.json`, `orient.command` — before → after

Before:

    "command": { "$ref": "#/$defs/NonEmptyString" }

After (presence of a description normative; wording indicative):

    "command": {
      "$ref": "#/$defs/NonEmptyString",
      "description": "Orient provider command, split on whitespace and run without a shell; it receives a JSON request on stdin and must print a JSON response on stdout. Full contract: `phax --usage`, cmd orient."
    }

### `phax orient` with no orient block — before → after

Before:

    No orient provider is configured. Add an `orient: { command }` block to phax.json to enable `phax orient`.
    $? = 1

After (exit code and the two named items normative; wording indicative):

    No orient provider is configured. Add an `orient: { command }` block to phax.json; the provider contract is documented under `phax --usage` (cmd orient).
    $? = 1

### README, Configure section (indicative)

A new "Orient provider" subsection showing the config block, a summary of the contract in the
same terms as the usage long help, and a link to the `phax orient` reference entry.

### `examples/hello-world` (file names indicative; behavior normative)

    examples/hello-world/phax.json      gains  "orient": { "command": "node ./orient.mjs" }
    examples/hello-world/orient.mjs     a provider with a small inline row table

    $ cd examples/hello-world && phax orient --file src/index.ts
    [info] keep-it-simple — hello-world stays a single file
    $ phax orient keep-it-simple
    <the row's body>

## 7. Non-goals

- Changing the provider contract or the `orient.command` shape. The command stays a single
  whitespace-split string, consistent with gate step commands; no argv-array form is added.
- Adding an orient question to the `phax init` wizard. Orient requires building a provider, so
  the setup cost is the contract, not the key.
- Probing the provider from `phax validate`, or any new liveness or self-test command.
- Any change to how the brief is computed or woven into the prompt (spec 17 behavior).
- Descriptions for other `phax.json` keys. Only three fields carry one today; a schema-wide
  description pass is a separate spec.

## 8. Acceptance criteria

### Usage spec states the full contract

Given the installed binary, when `phax --usage` runs, then the `orient` entry has a `long_help`
that names `orient.command`, the whitespace/no-shell rule, `{"files": [...]}`,
`{"expand": "<id>"}`, `{"rows": [...]}`, `{"row": ...}`, the `error | warn | info` set,
`{"row": null}`, the exit-0 rule and the implicit allowlist grant. (refs §5.1)

### Usage spec carries examples

Given the installed binary, when `phax --usage` runs, then the `orient` entry has at least one
`example` invoking `phax orient <id>` and one invoking `phax orient --file <path>`. (refs §5.2)

### Generated docs are current

Given the regenerated usage spec, when the CLI docs generator runs, then `docs/cli/reference.md`
and the README command list contain the `orient` long help and examples and the working tree is
unchanged afterwards. (refs §5.3)

### Schema describes the command

Given a project initialised with `phax init` or upgraded with `phax schema upgrade`, when
`phax.schema.json` is read, then `properties.orient.properties.command` carries a `description`
that mentions whitespace splitting and `phax --usage`. (refs §5.4)

### Unconfigured invocation names the contract location

Given a valid `phax.json` with no orient block, when `phax orient --file src/x.ts` runs, then it
exits 1 and the error names `orient: { command }` and `phax --usage`. (refs §5.5)

### README documents orient

Given the README, when its Configure section is read, then it contains an `"orient"` config block
and a link to the `phax orient` reference entry. (refs §5.6)

### Example project answers a pull

Given `examples/hello-world` with its shipped provider, when `phax orient --file <a file in the
example>` runs there, then at least one row prints and the exit code is 0; and when
`phax orient <that row's id>` runs, then its body prints and the exit code is 0. (refs §5.7)

### Example provider decodes against the enforced contract

Given the shipped example provider, when a test feeds it an index request and an expand request
and decodes each response with phax's response validation, then both decode successfully.
(refs §5.8)

## 9. Open questions for implementation planning

Question: keep the single-string command and document the whitespace split, or move
`orient.command` to an argv array?

- Keep the string — abandons: pipelines and paths with spaces without a wrapper script.
- Argv array — abandons: consistency with gate step commands and this spec's bounded scope; a
  config shape change rides in a discoverability fix.

Recommendation: keep the string and document the rule (§7 records it as a non-goal).

Resolved 2026-09-03: keep the string.

Question: what runtime does the example provider use?

- Node script — abandons: nothing the example does not already require; hello-world runs `pnpm`.
- Shell script — abandons: portable JSON handling; every reader would need `jq` or hand-rolled
  parsing, which is the wrong first impression of the contract.

Recommendation: a dependency-free Node script.

Resolved 2026-09-03: Node script.

## 10. Implementation-planning note

Settled: the contract spellings in §6 are normative and match what phax enforces today; nothing
in the protocol changes. The usage spec generator already emits `long_help` and `example` from
per-command documentation metadata, and the CLI reference and README command list are derived
from the usage spec, so §5.3 should fall out of regeneration rather than hand edits. The config
schema already carries generated descriptions for at least one field, so §5.4 should reuse that
mechanism rather than post-process the JSON.

Deliberately open (confirmed 2026-09-03): whether the contract text is authored once and shared
between the usage long help and the schema description, or written twice, is the planner's call.
Either way the plan must keep a single test that pins the normative facts so the two cannot
drift silently.

Constraint: no change to `src/schemas/orient.ts` semantics or to the orient config shape; a plan
that finds it needs either has left this spec's scope.
