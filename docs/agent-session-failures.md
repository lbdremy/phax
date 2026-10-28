# Troubleshooting a failed agent session

A command that drives an agent (`run`, `resume`, `artifact new`, `artifact decide`, `review-code`, `review-compliance`) can fail because the agent's session did. This page is for the moment it prints `✗ <provider> session failed (<kind>): …` and you want to know whether to retry, resume or fix something.

## Read the failure line

```console
✗ claude-code session failed (network): API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)
  session: 3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42
  See /home/you/.phax/runs/example.greet/phase-02/agent-error.log and output.jsonl
  Retry once the network is back: phax artifact decide docs/specs/2610041201-greet-spec.md --verdicts verdicts.json
```

- The **kind** in parentheses says what happened: `network`, `provider-error`, `max-turns`, `killed`, `unknown`, or a limit (`rate-limit`, `usage-limit`).
- The text after it is the provider's own message, not phax's.
- `session:` is the provider's session id, when it reported one.
- `See …` names the two files to read. `agent-error.log` starts with a `failure:` header (the cause), then the command that ran and the provider's stderr. The transcript (`output.jsonl`) sits beside it.
- A `network` failure ends with the command to run again once you are back online.

## Example: the network went away

You run `phax artifact decide` while your DNS is down. The agent retries ten times, gives up, and phax prints the lines above. The command exits 14.

If records are on with transcripts and an in-repo destination, phax also asks `gh` whether the repository is public, and that needs the network too. The record is refused, and the refusal is printed after the failure it follows:

```console
⚠ decision record refused, following the failed session: this repo's visibility could not be determined — gh: error connecting to api.github.com, and transcripts are enabled with an in-repo destination (remedy: retry once the network is back)
```

Read it as a consequence of the outage, not a second problem. Once the network is back, run the retry command the failure printed. The record is written by the retry. Setting `acknowledgedUnknownVisibility` is not the fix: phax only suggests it when `gh` failed for a reason a retry cannot cure.

For a run, the failed phase's own record can be refused the same way (`phase record refused, following the failed session: …`). A run that lost the network pauses instead of failing: it keeps its worktree and session, and `phax resume <run>` continues where it stopped.

## Exit codes

| Exit | Meaning                                                                          | What to do                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 5    | The session failed for a reason that is not the network or a limit.              | Read `agent-error.log` and the provider's message. Fix the cause (a bad model name, a refused request, a turn limit), then run the command again. Not resumable. |
| 8    | A rate or usage limit.                                                           | The run keeps its place. `phax resume <run>` once the limit resets (`resetAt` is printed when the provider gave one).                          |
| 14   | The provider could not be reached (a network failure).                           | Check your connection, then run the printed retry command; a paused run continues with `phax resume <run>`. Resumable.                          |

## When the same failure keeps coming back

- A `network` failure that persists with a working connection usually means a proxy or firewall in front of the provider; the provider's message in `agent-error.log` names the host.
- A `provider-error` that quotes an authentication message needs you to log in to the provider's own CLI again.
- Wording phax does not recognise as a connection problem reads as `provider-error` (exit 5), even when the cause is the network. If `agent-error.log` shows a connection error under exit 5, the retry is still the right move; please report the wording.
