# Troubleshooting a failed agent session

A command that drives an agent (`run`, `resume`, `artifact new`, `artifact decide`, `review-code`, `review-compliance`) can fail because the agent's session did. This page is for the moment it prints `✗ <provider> session failed (<kind>): …` and you want to know whether to retry, resume or fix something.

## Read the failure line

A run whose phase lost the network prints:

```console
✗ claude-code session failed (network): API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)
  session: 3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42
  See /home/you/.phax/runs/example.greet/phase-02/agent-error.log and output.jsonl

Run greet is paused at phase-02.

Next steps:
  • Retry once the network is back — no reset time to wait for
    phax resume greet --yes
See /home/you/.phax/runs/example.greet/resume-instructions.md for details.
```

- The **kind** in parentheses says what happened: `network`, `provider-error`, `max-turns`, `killed`, `unknown`, or a limit (`rate-limit`, `usage-limit`).
- The text after it is the provider's own message, not phax's.
- `session:` is the provider's session id, when it reported one.
- `See …` names the two files to read. `agent-error.log` starts with a `failure:` header (the cause), then the command that ran and the provider's stderr. The transcript (`output.jsonl`) sits beside it.
- A `network` failure ends with the command to run again once you are back online. Every `phax resume` it names carries `--yes`: without it, `phax resume` only previews.

## Example: the network went away

You run `phax artifact decide` while your DNS is down. The agent retries ten times, gives up, and phax prints the failure with the decide session's own folder and its retry:

```console
✗ claude-code session failed (network): API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)
  session: 3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42
  See /home/you/.phax/decide/2610281402-greet-spec/01/agent-error.log and output.jsonl
  Retry once the network is back: phax artifact decide docs/specs/2610041201-greet-spec.md --verdicts verdicts.json
```

The command exits 14.

If records are on with transcripts and an in-repo destination, phax also asks `gh` whether the repository is public, and that needs the network too. The record is refused, and the refusal is printed after the failure it follows:

```console
⚠ decision record refused, following the failed session: this repo's visibility could not be determined — gh: error connecting to api.github.com, and transcripts are enabled with an in-repo destination (remedy: retry once the network is back)
```

Read it as a consequence of the outage, not a second problem. Once the network is back, run the retry command the failure printed. The record is written by the retry. Setting `acknowledgedUnknownVisibility` is not the fix: phax only suggests it when `gh` failed for a reason a retry cannot cure.

For a run, the failed phase's own record can be refused the same way (`phase record refused, following the failed session: …`). A run that lost the network pauses instead of failing: `phax ls` lists it as `rate_limited`, the state a limit leaves too, but there is no reset time to wait for, so you can resume it as soon as the network is back. `phax resume <run> --yes` starts a new provider session in the same worktree; the work the phase had done there stays.

Codex does not end its session when the network goes: it prints `Reconnecting...` and keeps waiting for the network. If a Codex phase sits there, interrupt phax (Ctrl-C), then resume the run once the network is back.

## Exit codes

| Exit | Meaning | What to do |
| ---- | ------- | ---------- |
| 1 | `review-code` or `review-compliance`: the review's session failed for a reason that is not the network. | Read `agent-error.log` and the provider's message, fix the cause, then run the review again. |
| 5 | The session failed for a reason that is not the network or a limit. | Read `agent-error.log` and the provider's message. Fix the cause (a bad model name, a refused request, a turn limit), then run the command again. Not resumable, except a failed handoff turn: the phase is committed and the run stops `interrupted`; `phax resume <run> --yes` runs only the handoff again. |
| 8 | A rate or usage limit. | The run keeps its place. `phax resume <run> --yes` once the limit resets (`resetAt` is printed when the provider gave one). |
| 14 | The provider could not be reached (a network failure). | Check your connection, then run the printed retry command; a paused run continues with `phax resume <run> --yes`, straight away. Resumable. |

## A failure after a retry

When the next session starts in the same folder (a resume of the phase, the retried handoff), phax first archives the failure the earlier session left there, so `agent-error.log` only ever describes the latest failure:

- `agent-error.log` becomes `agent-error.failed-NN.log`, numbered from `01` in that folder.
- The transcript the new session is about to write takes the same number before its extension: `output.jsonl` becomes `output.failed-NN.jsonl` (a Vibe turn's `output.vibe-export/` becomes `output.failed-NN.vibe-export/`). The archived log's `transcript:` line names the new name.
- A transcript the new session does not write (an earlier closing turn's `closing-turn-01.jsonl`, say) stays where it is, and the archived log still names it.

A phase's record carries `agent-error.failed-NN.log` as it carries `agent-error.log`, but never an archived transcript: it is another session's.

## When the same failure keeps coming back

- A `network` failure that persists with a working connection usually means a proxy or firewall in front of the provider. The provider's message names the error it got (`ENOTFOUND`, `ECONNREFUSED`, `All connection attempts failed`), not always the host.
- A `provider-error` that quotes an authentication message needs you to log in to the provider's own CLI again.
- Wording phax does not recognise as a connection problem reads as `provider-error` (exit 5), even when the cause is the network. If `agent-error.log` shows a connection error under exit 5, the retry is still the right move; please report the wording.
