Write the phax spec "Partial commands on gate steps". A gate step can name, in `phax.json`, the command that checks a subset of what the step checks — on some files, or on the current diff. phax never runs it; it relates it to the step, shows it to the agent in the phase prompt, and allows it in secure mode like the step itself.

**Builds on** `docs/specs/2611041203-phase-prompt-names-the-gate.md` (Approved; a prerequisite): the phase prompt gains a `## Gate` section listing the resolved gate steps with their surface, says a failing step resumes the same session, and that in-loop the agent checks each change with the narrowest command that covers it. That spec cannot say *what* the narrowest command is for a project; this one lets the project say it next to the step.

**Why.** Measured on phax's records (2026-11-04, 318 phase sessions; `docs/ideas/harness-from-records.md`, `spikes/harness-data/`): phases spend 27% of their wall time waiting on feedback commands they run themselves; whole-suite test runs are the largest share (6.7 h over 403 calls, against 1.3 h over 1,193 targeted calls). The agent rediscovers the targeted forms in each session; in another project (steme) the right partial command is not guessable. phax computing the scope itself does not pay here (`vitest related src/app/gates.ts` selects 99 of 613 test files, 203 s): the project knows how to run a part, phax does not.

**Shape agreed so far (operator, 2026-11-04):**

```json
{
  "command": "pnpm lint",
  "surface": "local",
  "firing": "every-phase",
  "partial": {
    "files": "pnpm exec oxlint <files>",
    "diff": "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint"
  }
}
```

- `partial` is optional per step, with two named variants, `files` (run on the files the agent names) and `diff` (run on the current diff). In a phase worktree nothing is committed before the gate, so "the current diff" is the uncommitted changes, which many tools read natively (`vitest run --changed`).
- **Shown, never run.** The gate is unchanged: same steps, same whole commands. phax does not execute a partial command, does not derive it from the diff, and does not judge the session on it.
- **The prompt relates the two:** under the step, "on some files: …", "on your changes: …".
- **Allowed like the step.** A partial command is committed config beside the gate command, at the same trust level, so phax allowlists it in secure mode as it allowlists gate commands; the project does not duplicate it in `security.agentCommands`.

**Probe, Claude Code 2.1.318, headless, `--permission-mode acceptEdits --allowedTools …` (phax's secure flags), Haiku asked to run one command:**

| Command                    | Allowed                          | Result                                                                        |
| -------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| `wc -l $(ls *.txt)`        | `Bash(wc:*)`, `Bash(ls:*)`       | denied: "A nested command in this command can't be checked before it runs"    |
| same                       | the exact string as one rule     | denied, same message                                                          |
| `ls *.txt \| xargs wc -l`  | `Bash(ls:*)`, `Bash(xargs wc:*)` | ran                                                                           |
| `wc -l one.txt two.txt`    | `Bash(wc:*)`                     | ran                                                                           |

So a `diff` variant must be written as a pipe, never with `$(…)`, and phax allows each pipe segment's prefix.

**Separate, not this feature:** splitting a whole gate step into tiers (`pnpm test` → `pnpm test:unit` + `pnpm test:integration`) is a project choice that, with the gate section, shows the agent which tiers exist. Worth doing on its own.

**Settled (do not reopen):** the shape above (`partial` optional per step, variants `files` and `diff`, at least one when present); shown, never run; allowed in secure mode like the step; the gate unchanged; project- and provider-agnostic wording (phax knows no tool).

**What exists (read it first):**
- `src/schemas/phaxConfig.ts`: `GateStepSchema` (`command`, `surface`, `firing`, `output`, `input`), `GateProfilesSchema`; `phax.schema.json` (generated).
- `src/domain/session/claudePermissionFlags.ts`: agent commands become `Bash(<prefix>:*)` rules; gate commands are allowlisted the same way.
- `src/infra/providers/mistralVibe.ts` and `docs/security.md` ("Shell command execution"): Vibe's prefix allowlist through `VIBE_TOOLS`; Codex's sandbox.
- `src/app/promptGeneration.ts`, `src/app/gates.ts`, `src/app/executePlan.ts`: the gate section and gate resolution as the prerequisite spec changes them.

**Out of scope:** phax running a partial command or deriving one from the diff; timing gate steps; splitting this repository's gate steps into tiers; authoring, decide and review prompts.

**Open questions for §9 (each with a recommendation):**
1. **Placeholder for `files`.** Plain text the agent reads (`<files>`), or a convention phax checks? phax never runs it, but must find each segment's runnable prefix to allow it. Recommendation: a documented `<name>` placeholder; a segment's allowed prefix is its words before the first placeholder; a `files` command without a placeholder is refused at load.
2. **Allowing pipe segments.** Recommendation: split on `|` only; refuse at config load a partial command holding `;`, `&&`, `||`, `$(…)`, backticks or a redirection, naming the step and the variant (Claude Code denies `$(…)` anyway, probe above); each segment becomes a prefix rule, with the known prefix residual stated in `docs/security.md`.
3. **Mistral Vibe.** Whether a pipe with every segment allowed runs under its prefix allowlist is unknown. Recommendation: the spec's acceptance includes a real-CLI check on Vibe; until it passes, Vibe phases show the partial commands but phax records the limit rather than guessing.
4. **Empty diff.** `xargs` with no input may run the tool with no path, i.e. on the whole repository. Recommendation: phax says nothing; the docs example uses a form that handles it, and the docs page names the trap.
5. **phax's own profile.** Runs use the released phax, whose config decoder refuses unknown keys. Recommendation: this repository's `phax.json` gains `partial` in a follow-up commit after the release that accepts it, not in the run.
