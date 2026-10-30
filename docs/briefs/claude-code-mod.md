Write the phax spec "Claude Code mod", its first milestone: reading. A Claude Code mod, shipped from this repository, shows the current repository's phax state beside the conversation — an inbox of what waits for the operator, the specs with their plans and each plan's runs — without the operator running a command. It reads only what phax prints as JSON, and writes nothing.

**Why.** Today the operator drives phax by talking to Claude Code, which calls the CLI. That stays. What is missing is the state at a glance: which spec or plan has open questions or waits for approval, which run stopped and waits, what a spec still lacks to be complete. The operator decided on 2026-10-30 to start the cockpit (`docs/ideas/desktop-app.md`) with this mod: it can be built quickly, for one operator in one repository, with no storage of its own. The web cockpit keeps what one terminal cannot give — a team, history, several repositories, several engines, phax's cloud mode.

**Mod facts, checked on 2026-10-30 against Claude Code 2.1.314's own types (the `plugin-authoring` skill writes them; read them again before planning, by name):**
- A mod is a plugin whose `hooks/hooks.json` names one module exporting `register(on, options)`; every hook is `($, e, next)`. The module runs with no DOM and no Node: everything outside it goes through `$`.
- A pane beside the conversation is `$.ui.open({ id, title })`, drawn by a `ui.render` hook on `{ component: 'Pane', requestId }`. A band above the prompt is a `ui.render` hook on `{ component: 'AbovePrompt' }`. Elements come from `$.ui.resolve(e)`, by surface (`terminal`, `desktop`, `vscode`, `mobile`).
- State a drawing reads is an atom: `read` while drawing, `update` from a handler or another event, never during a render; each value is declared in the mod's `types/index.d.ts`.
- `$.process.spawn({ argv, cwd })` runs a process, so the mod runs `phax … --json`. The session's working directory comes with the session's events (`cwd`).
- `$.command.register` adds a slash command; `$.tool.register` adds a tool the model calls; `$.prompt.submit({ text, asUser })` sends a message into the conversation.
- `claude plugin validate <folder>` checks the module the way the engine loads it; `claude plugin test <folder>` runs its `*.test.ts`.

**What phax gives the mod today (0.31.0):**
- `phax runs list --json`: a versioned `run-list` document; per run its state, branch, current phase and `stop`, the review-stop document when the run waits at a stop. Enough for the band and for the stopped runs. It carries no pull-request URL.
- `phax plans overview --json`: per phase its model, effort and mode, its acceptance role, the planned files by architecture part, its test lines, and the coverage of the source spec's criteria by those lines. The document is **unversioned**, like `phax plans lint --json`'s.
- The spec document sidecar (`spec-document`, in `@lbdremy/phax-schemas`): `requirements`, `surface`, `acceptanceCriteria` whose `refs` name requirements, `openQuestions`, `arbitratedQuestions`. A `surface` element has **no id and no link** to the criteria or the requirements. A hand-authored artifact has no sidecar.
- `phax artifact status`: kind, status, legal transitions, approval and its approver, edited since approval or not, authoring mode and sidecar sync, and a Questions line. **Text only**: there is no `--json`.
- The extracted plan a run executed (`phax-plan.json`, `phax-plan` schema) and the phase status (`phase-status`), so a plan changed since its run started can be shown as the run executed it.

**Settled by the operator (do not reopen):**
1. **A pure reader.** phax is the only source of truth. The mod stores nothing and keeps no database: every view is derived from what phax prints, read again on each refresh.
2. **It never writes.** Any action goes through phax's commands, which keep their checks. In this milestone the mod takes no action at all.
3. **The current repository.** The mod reads the `phax.json` of the session's working directory and shows that project only.
4. **phax's JSON only, against its published schemas.** The mod reads what phax prints with `--json` and the sidecars, validated against the versioned schemas of `@lbdremy/phax-schemas`. It parses no Markdown and no human text. Whatever the mod needs that phax prints only as text, or prints unversioned, phax adds first: the spec "Command contracts" (brief `docs/briefs/command-contracts.md`) does, and this spec names it as its prerequisite.
5. **A plan and its runs are one view.** A run is the execution of a plan; it has no view of its own.
6. **Layout.**
   - **A band above the prompt**, always one line: the runs in progress (an indicator, never an action) and the number of items in the inbox.
   - **One pane, one page**: no tabs. A breadcrumb at the top (spec › plan › run) places the view and goes up in one click. The home holds the inbox, pinned at the top, and the tree: the specs, under each its plans, under each plan its runs.
   - **The inbox holds only what waits for the operator:** specs and plans with open questions or not yet approved; finished runs, with their plan's view and the pull request; runs stopped on the way that wait for the operator — the most urgent, first. An item leaves the inbox as soon as phax's state no longer calls for it: question decided, artifact approved, pull request merged and the run archived. The mod remembers nothing to do so.
   - **A spec's view** shows its surface, not its acceptance criteria — the surface is what tells at once whether the spec goes the right way — and how its plans cover it: covered, partly covered, orphaned (§9 Q1). It answers *what is still missing to finish this spec*. From it: the spec's plans, and the full Markdown.
   - **A plan's view** builds on `phax plans overview`: its whole lifecycle on one view (Draft, Approved, running, finished, archived); per phase its model, what it does and the architecture parts it touches. When a run is running or finished, each phase carries its state: to do, running, in its fix loop, passed with a green gate, failed. Several runs: the latest by default, the earlier ones in a history. A plan changed since its run started: shown as the run executed it. From it: the pull request, a finished run's records, the full Markdown.
   - **The full Markdown**, read-only. A spec or a plan changes by decisions in phax, never by hand in the mod.
7. **Versions.** The mod lives in this repository and depends on `@lbdremy/phax-schemas`; the release workflow publishes a new version of the mod whenever a schema is added or changed. A phax newer than every version the mod knows shows one clear line — this phax version is not supported, update the mod — never a broken view.
8. **The terminal first.** Little room: compact views that fold.

**Later milestones, not this spec:** milestone 2, collaboration — tools for the model to open the pane on a spec, a plan or a question, and to highlight a section or a question by its id (never by line); the open questions listed with their options and recommendation; a verdict given in the pane through `phax artifact decide --verdicts - --by operator`, which needs no terminal and keeps every check; a "discuss" button that fills the prompt with the chosen questions' context. Milestone 3: the coming revision command beside the verdicts, the briefs, a `/phax` command, a refresh at each turn's end.

**Leave §9 to one question,** framed by what it abandons:
- **Q1, at which level the coverage is shown.** By requirement, which phax already links (a criterion's `refs`, then `plans overview`'s test lines), the spec's view showing requirements beside the surface; or by surface element, as the operator first asked, which needs the spec document to give each `surface` element an id and the requirements it serves — a change to the `spec-document` shape, the authoring skill and lint, and the migration of existing sidecars.

**What exists (read it first):**
- `docs/ideas/desktop-app.md`, the cockpit this mod starts;
- `phax runs list`, `phax plans overview`, `phax artifact status`, `phax artifact decide --verdicts` in `phax --usage`;
- `packages/schemas/` (`run-list`, `phase-status`, `phax-plan`, `spec-document`, `plan-document`, `review-stop`) and how phax exports them;
- the brief `command-contracts`, its prerequisite: `artifact status --json` (`artifact-status`), `plans overview --json` versioned (`plan-overview`), and each run's pull request in `run-list`.

**Out of scope:**
- any write, verdict or approval from the mod (milestone 2);
- several repositories, history kept by the mod, team views, other engines than Claude Code: the web cockpit's;
- blocking a run's writes to protected files: a run's agents are processes phax starts, which a mod in the operator's session does not see; the brief `protected-paths` covers it;
- editing a spec or a plan in the mod.

**Surfaces.** A surface's `summary`, `before` and `after` are read by users in the release notes: a capitalized sentence and short real examples, with no implementation notes. Name `$schema` URLs at 0.32.0.

**Output:** your final message is the spec document JSON and nothing else: no sentence before or after it, and no code fence.
