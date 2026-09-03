---
status: Approved
date: "2026-09-03 (re-approved against main a4ec669 after widening to the gate diagnostics
  contract; original approval the same day covered orient only)"
audience: implementation planning with Claude Code
scope: functional behavior and consumption surface
---

# Provider Contract Discoverability

## 1. Context

phax has two places where an operator plugs in an external program that must speak a JSON
contract phax enforces at runtime:

- **Orient** (spec 17, archived). An operator registers one provider command in `phax.json`;
  phax asks it for an orientation **index** keyed by a phase's planned files and weaves the
  index into the phase prompt; the in-phase agent pulls more with `phax orient <id>` (a row's
  body) or `phax orient --file <path>` (an index for any file).
- **Gate diagnostics** (spec 16, archived). A gate step may declare `"output": "diagnostics"`;
  phax then decodes the step's stdout as a diagnostics document and takes the step's verdict from
  that document instead of the exit code, feeding the diagnostics rather than the raw log into
  the fix prompt.

Both specs pinned the field minimum as normative and left spellings and transport **indicative**.
The implementation then fixed all of them:

- Orient: phax runs the command with no shell, splitting the string on whitespace; writes one JSON
  object on stdin; expects exit code 0 and one JSON object on stdout; rejects any response that
  fails validation. Once an orient block is present, `phax orient` is allowed to the in-phase
  agent without an explicit grant.
- Diagnostics: stdout must decode as `{ "diagnostics": [{ "rule", "location": { "file",
  "line"? }, "message", "repair" }] }`. A non-empty list fails the step whatever the exit code;
  exit 0 with an empty list passes; a missing or undecodable document, or a non-zero exit with an
  empty list, is a provider error that fails the step with the raw log. A failing document is
  persisted as `checks-attempt-NN.diagnostics.json`.

Today's public surfaces:

- `phax --usage`, the declared source of truth for the CLI contract, carries only the consumer
  side of orient and nothing about diagnostics (no command owns it):

      cmd "orient" {
          help "Pull orientation from the configured orient provider: expand a row by id, or pass --file to get an index for an arbitrary file"
          arg "[id]" { help "Row id to expand" }
          flag "--file" { arg "<path>" help "Return an index for an arbitrary file instead of expanding a row id" }
      }

- `phax.schema.json` types both keys with no description:

      "orient": { "type": "object", "required": ["command"],
                  "properties": { "command": { "$ref": "#/$defs/NonEmptyString" } } }
      "output": { "type": "string", "enum": ["log", "diagnostics"] }

- `phax orient` without configuration prints the only hint that names the orient key:

      No orient provider is configured. Add an `orient: { command }` block to phax.json to enable `phax orient`.

- A diagnostic step that returns no document fails with:

      Gate step "pnpm audit:security" declared diagnostics output but returned none: <reason>

- The README Configure section documents the diagnostics document and verdict rules in prose and
  shows a diagnostics step in the manual `phax.json` example. It never mentions orient. The README
  command list and `docs/cli/reference.md` repeat the orient usage help line verbatim. The
  `phax init` wizard and `examples/hello-world` mention neither contract.

## 2. Problem

A developer or agent holding only the installed binary can discover that `orient.command` and a
gate step `output` enum exist, and cannot discover from the binary what either program must do.
The orient request and response shapes, the exit-code rule, the no-shell tokenization and the
implicit allowlist grant live only in source and in an archived spec that declined to make them
binding. The diagnostics document shape and verdict rules live in the README and in source; the
generated schema, which is what an editor shows next to the key, says only `log | diagnostics`.
Neither example project exercises either contract, so there is no runnable reference to copy.

This contradicts the project's own rule that the generated contracts never drift from the binary
and are the place to read them.

## 3. Product goal

Make both provider contracts readable from the phax surfaces a developer already reaches for,
without opening phax's source or its archived specs: `phax --usage` for the command-owned
contract, the generated config schema for the config-owned contract, the error output each
contract emits when unmet, the README, and the shipped example project.

> A provider contract lives where its consumer already reads phax: a command's contract in
> `phax --usage`, a config key's contract in `phax.schema.json`; if neither can tell you how to
> satisfy phax, the contract is not documented.

## 4. Terminology

- **Orient provider** — the operator-supplied command phax runs to obtain orientation.
- **Index request / expand request** — the JSON phax sends the orient provider for rows keyed by
  files, or for one row's body by id.
- **Row** — one orientation entry: `id`, `title`, `severity` (`error | warn | info`), `trigger`;
  an **expanded row** additionally carries `body`.
- **Diagnostic step** — a gate step with `"output": "diagnostics"`.
- **Diagnostics document** — the JSON a diagnostic step prints on stdout: a `diagnostics` list
  whose entries carry `rule`, `location` (`file`, optional positive `line`), `message`, `repair`.
- **Provider contract** — for orient: the config key, invocation rule, both requests, both
  responses, the exit-code rule, the allowlist grant. For diagnostics: the step field, the
  document shape, the verdict rules, the provider-error rule, the persisted document.
- **Usage spec** — the `phax.usage.kdl` document printed by `phax --usage`, from which the CLI
  reference and the README command list are regenerated.

## 5. Functional requirements

### 5.1 Orient contract in the usage spec

The `orient` entry of the usage spec SHALL carry a long help that states the orient provider
contract in full: the config key, the no-shell whitespace tokenization, the index and expand
request shapes, the index and expand response shapes including the severity set and the null-row
case, the exit-code rule, and the implicit `phax orient` allowlist grant.

### 5.2 Orient examples in the usage spec

The `orient` entry of the usage spec SHALL carry at least one example for expanding a row by id
and one for indexing a file.

### 5.3 Generated documentation follows the usage spec

WHEN the CLI reference and the README command list are regenerated THE system SHALL reproduce
the `orient` long help and examples in both.

### 5.4 Config schema describes the orient command

The generated `phax.schema.json` SHALL describe `orient.command` with a description that states
what the command is, that it is tokenized on whitespace with no shell, and where the full provider
contract is read.

### 5.5 Config schema describes the diagnostics contract

The generated `phax.schema.json` SHALL describe the gate step `output` field with a description
that states the diagnostics document shape, the verdict rules (non-empty list fails, exit 0 with
an empty list passes, missing or undecodable document or non-zero exit with an empty list is a
provider error), and that the raw log is used when no document exists.

### 5.6 Unmet orient contract points at it

WHEN `phax orient` runs in a project with no orient block THE system SHALL name the config key and
name the usage entry where the provider contract is documented.

### 5.7 Unmet diagnostics contract states the expected shape

WHEN a diagnostic step returns no decodable document THE system SHALL name the step, the decode
reason, and the expected document shape in the provider error.

### 5.8 README documents both contracts

The README Configure section SHALL document orient with a config block and the provider
contract, SHALL link the `phax orient` reference entry, and SHALL keep the diagnostics document
and verdict rules it documents today.

### 5.9 Example project exercises both contracts

The `examples/hello-world` project SHALL include an orient block backed by a dependency-free
provider script, and a diagnostic gate step backed by a dependency-free script that prints a
diagnostics document.

### 5.10 Example scripts conform to the enforced contracts

IF the example orient provider's responses or the example diagnostic step's document do not
decode against phax's validation THEN the test suite SHALL fail.

## 6. Surface

### `phax --usage`, `orient` entry — before → after

Before (today): the block quoted in §1.

After. Presence of `long_help` and `example`, and every fact the long help states, are
**normative**; the prose wording and ordering are **indicative**:

    cmd "orient" {
        help "Pull orientation from the configured orient provider: expand a row by id, or pass --file to get an index for an arbitrary file"
        long_help "Requires an orient provider in phax.json:\n\n  \"orient\": { \"command\": \"node ./orient.mjs\" }\n\nphax runs the command with no shell — the string is split on whitespace, so use a wrapper script for pipelines or paths with spaces — from the current directory (the phase worktree during a run), writes one JSON request on stdin and expects exit code 0 and one JSON response on stdout.\n\nIndex request  {\"files\": [\"src/a.ts\", \"src/b.ts\"]}\nIndex response {\"rows\": [{\"id\": \"...\", \"title\": \"...\", \"severity\": \"error\"|\"warn\"|\"info\", \"trigger\": \"...\"}]}\n\nExpand request  {\"expand\": \"<id>\"}\nExpand response {\"row\": {\"id\", \"title\", \"severity\", \"trigger\", \"body\"}} or {\"row\": null} when the id is unknown\n\nAll fields are non-empty strings. A non-zero exit, non-JSON stdout or a response that fails validation is reported as a provider error (exit 1); an empty index or a null row prints \"No orientation available.\" and exits 0.\n\nDuring a run phax sends the index request for each phase's planned files and weaves the rows into the phase prompt. When orient is configured, `phax orient` is allowed to the in-phase agent without an explicit agentCommands grant."
        example "phax orient core-no-adapters"
        example "phax orient --file src/jobs/sync.ts"
        arg "[id]" { help "Row id to expand" }
        flag "--file" { arg "<path>" help "Return an index for an arbitrary file instead of expanding a row id" }
    }

The orient spellings above (`files`, `expand`, `rows`, `row`, `id`, `title`, `severity`,
`trigger`, `body`, the severity set, `null` for unknown id) and the diagnostics spellings
(`output: "diagnostics"`, `diagnostics`, `rule`, `location.file`, `location.line`, `message`,
`repair`) are **normative**: they promote the spellings specs 16 and 17 left indicative to the
contracts phax already enforces.

### `phax.schema.json` — before → after

`orient.command`, before:

    "command": { "$ref": "#/$defs/NonEmptyString" }

after (presence of a description normative; wording indicative):

    "command": {
      "$ref": "#/$defs/NonEmptyString",
      "description": "Orient provider command, split on whitespace and run without a shell; it receives a JSON request on stdin and must print a JSON response on stdout. Full contract: `phax --usage`, cmd orient."
    }

Gate step `output`, before:

    "output": { "type": "string", "enum": ["log", "diagnostics"] }

after (presence of a description and every rule it states normative; wording indicative):

    "output": {
      "type": "string",
      "enum": ["log", "diagnostics"],
      "description": "Default \"log\": stdout/stderr go to the attempt log and the exit code is the verdict. \"diagnostics\": stdout must be {\"diagnostics\": [{\"rule\", \"location\": {\"file\", \"line\"?}, \"message\", \"repair\"}]}; a non-empty list fails the step whatever the exit code, exit 0 with an empty list passes, and a missing/undecodable document or a non-zero exit with an empty list is a provider error that fails the step with the raw log. A failing document is saved as checks-attempt-NN.diagnostics.json and its entries drive the fix prompt."
    }

### Provider errors — before → after

`phax orient` with no orient block (exit code and the two named items normative; wording
indicative):

    No orient provider is configured. Add an `orient: { command }` block to phax.json to enable `phax orient`.
    →
    No orient provider is configured. Add an `orient: { command }` block to phax.json; the provider contract is documented under `phax --usage` (cmd orient).
    $? = 1

Diagnostic step with no decodable document (step name, reason and expected shape normative;
wording indicative):

    Gate step "pnpm audit:security" declared diagnostics output but returned none: invalid JSON at position 0
    →
    Gate step "pnpm audit:security" declared diagnostics output but returned none: invalid JSON at position 0 — expected {"diagnostics": [{"rule", "location": {"file", "line"?}, "message", "repair"}]} on stdout

### README, Configure section (indicative)

A new "Orient provider" subsection with the config block, the contract in the same terms as the
usage long help, and a link to the `phax orient` reference entry. The existing `output` bullet
stays as the diagnostics documentation.

### `examples/hello-world` (file names indicative; behavior normative)

    examples/hello-world/phax.json      gains  "orient": { "command": "node ./orient.mjs" }
                                        gains  { "command": "node ./audit.mjs", "surface": "structural",
                                                 "firing": "every-phase", "output": "diagnostics" }
    examples/hello-world/orient.mjs     a provider with a small inline row table
    examples/hello-world/audit.mjs      a check that prints {"diagnostics": []} on a clean tree
                                        and one diagnostic when its rule is violated

    $ cd examples/hello-world && phax orient --file src/index.ts
    [info] keep-it-simple — hello-world stays a single file
    $ phax orient keep-it-simple
    <the row's body>
    $ node ./audit.mjs
    {"diagnostics":[]}

## 7. Non-goals

- Changing either contract. The orient command stays a single whitespace-split string,
  consistent with gate step commands; no argv-array form. The diagnostics document shape and
  verdict rules stay as shipped by spec 16.
- A `config` section in the usage spec, or any other new generator capability, for config-owned
  contracts. The generated schema is their home (§9).
- Adding orient or diagnostics questions to the `phax init` wizard.
- Probing either provider from `phax validate`, or any new liveness or self-test command.
- Any change to how the brief is woven into the prompt (spec 17) or how diagnostics drive the
  fix loop (spec 16).
- Descriptions for other `phax.json` keys. A schema-wide description pass is a separate spec.

## 8. Acceptance criteria

### Usage spec states the full orient contract

Given the installed binary, when `phax --usage` runs, then the `orient` entry has a `long_help`
that names `orient.command`, the whitespace/no-shell rule, `{"files": [...]}`,
`{"expand": "<id>"}`, `{"rows": [...]}`, `{"row": ...}`, the `error | warn | info` set,
`{"row": null}`, the exit-0 rule and the implicit allowlist grant. (refs §5.1)

### Usage spec carries orient examples

Given the installed binary, when `phax --usage` runs, then the `orient` entry has at least one
`example` invoking `phax orient <id>` and one invoking `phax orient --file <path>`. (refs §5.2)

### Generated docs are current

Given the regenerated usage spec, when the CLI docs generator runs, then `docs/cli/reference.md`
and the README command list contain the `orient` long help and examples and the working tree is
unchanged afterwards. (refs §5.3)

### Schema describes the orient command

Given a project initialised with `phax init` or upgraded with `phax schema upgrade`, when
`phax.schema.json` is read, then `properties.orient.properties.command` carries a `description`
that mentions whitespace splitting and `phax --usage`. (refs §5.4)

### Schema describes the diagnostics contract

Given the same generated `phax.schema.json`, when the gate step `output` property is read, then
its `description` names `diagnostics`, `rule`, `location`, `file`, `line`, `message`, `repair`,
the non-empty-list-fails rule, the empty-list-passes rule and the provider-error rule. (refs §5.5)

### Unconfigured orient names the contract location

Given a valid `phax.json` with no orient block, when `phax orient --file src/x.ts` runs, then it
exits 1 and the error names `orient: { command }` and `phax --usage`. (refs §5.6)

### Missing diagnostics document names the expected shape

Given a diagnostic step whose command prints non-JSON, when the gate runs, then the step fails as
a provider error whose message names the step command, the decode reason, and contains
`"diagnostics"`, `"rule"`, `"location"`, `"message"` and `"repair"`. (refs §5.7)

### README documents both contracts

Given the README, when its Configure section is read, then it contains an `"orient"` config
block, a link to the `phax orient` reference entry, and the `output` bullet describing the
diagnostics document. (refs §5.8)

### Example project answers an orient pull

Given `examples/hello-world` with its shipped provider, when `phax orient --file <a file in the
example>` runs there, then at least one row prints and the exit code is 0; and when
`phax orient <that row's id>` runs, then its body prints and the exit code is 0. (refs §5.9)

### Example project carries a diagnostic step

Given `examples/hello-world`, when its `phax.json` is validated, then one gate step has
`"output": "diagnostics"`, and when that step's command runs on the example's clean tree, then it
prints `{"diagnostics": []}` and exits 0. (refs §5.9)

### Example scripts decode against the enforced contracts

Given the shipped example scripts, when a test feeds the orient provider an index request and an
expand request and runs the diagnostic script, then all three outputs decode successfully with
phax's validation. (refs §5.10)

## 9. Open questions for implementation planning

Question: keep the single-string orient command and document the whitespace split, or move
`orient.command` to an argv array?

- Keep the string — abandons: pipelines and paths with spaces without a wrapper script.
- Argv array — abandons: consistency with gate step commands and this spec's bounded scope.

Recommendation: keep the string and document the rule. Resolved 2026-09-03: keep the string.

Question: what runtime do the example scripts use?

- Node scripts — abandons: nothing the example does not already require; hello-world runs `pnpm`.
- Shell scripts — abandons: portable JSON handling; every reader would need `jq`.

Recommendation: dependency-free Node scripts. Resolved 2026-09-03: Node.

Question: where does a config-owned contract with no command live?

- Schema description — abandons: `phax --usage` as the one place to read every contract.
- `config` block in the usage spec — abandons: this spec's bounded scope; a new generator
  capability rides a docs fix.
- `phax run` long help — abandons: findability; readers of run help get a contract most never use.

Recommendation: schema description; the generated schema is already the config contract the
binary emits. Resolved 2026-09-03: schema description.

## 10. Implementation-planning note

Settled: the contract spellings in §6 are normative and match what phax enforces today; nothing
in either protocol changes. The usage spec generator already emits `long_help` and `example`
from per-command documentation metadata, and the CLI reference and README command list are
derived from the usage spec, so §5.3 should fall out of regeneration rather than hand edits. The
config schema already carries a generated description for at least one field, so §5.4 and §5.5
should reuse that mechanism rather than post-process the JSON.

Deliberately open (confirmed 2026-09-03): whether each contract's text is authored once and
shared between its usage long help or error message and its schema description, or written
twice, is the planner's call. Either way the plan must keep a single test per contract that pins
the normative facts so the copies cannot drift silently.

Constraint: no change to the orient or diagnostics validation semantics, and no change to either
config shape; a plan that finds it needs either has left this spec's scope.
