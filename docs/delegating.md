# Delegating from an agent

phax is verified delegation for AI coding agents: delegate a change to another coding agent and get results you can verify.

- Each phase runs in an isolated Git worktree.
- Its gate commands must exit 0 before the next phase starts.
- The files it touched are reconciled with the plan.
- Run state outlives your context: phax resume picks up where the run stopped.
- Every command answers JSON with a schema.

## Delegate a change

The commands a coding agent calls, in order, each answering JSON:

```sh
# Draft a spec from a brief read on stdin
phax artifact new spec <slug> --headless --brief - --json
# Write the operator's verdicts on its open questions, then approve it
phax artifact decide <spec> --verdicts <file> --by operator --json
phax artifact approve <spec> --by machine:<grant> --json
# Draft its plan from a brief read on stdin
phax artifact new plan <slug> --headless --brief - --spec <spec> --last --json
# Lint the plan, then approve it: a run takes an Approved plan
phax plans lint <plan> --json
phax artifact approve <plan> --by machine:<grant> --json
# Run it, each phase in its own worktree behind your gates
phax run --plan <plan> --json
# Read the compliance verdict against the plan
phax review-compliance <run> --json
# List every finding of the run's reviews and its fate
phax finding list <run> --json
```

An agent has no terminal, so every approval names its approver: `--by machine:<grant>` names the loop or script by a kebab-case grant, and `--by operator` names the person, as git does. A plan is approved after its spec. A verdict on an open question always comes from the operator: `phax artifact decide` takes their verdicts file with `--by operator` and refuses a machine, and with no open question it says there is nothing to decide.

For example, an agent drafts a spec and its plan, lints the plan and runs it. It reads the outcome's kind and the exit code, then the compliance verdict, and each finding's fate with `phax finding list --json`, instead of trusting another agent's "done".

## Read the answers

- `--json` on every command writes its answer on stdout and its messages as JSON lines on stderr: see [Machine answers](json-output.md).
- `--json-schema` prints the program's contracts as JSON Schema, or one command's after its name, and runs nothing: see [Machine answers](json-output.md).
- Each exit code names what happened: see [Exit codes](../README.md#exit-codes).
- `phax --usage` prints the full command tree, every command with its flags and arguments.
