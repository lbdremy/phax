---
status: Completed
source-spec: docs/specs/2611041509-finding-ids-and-fates.md
completes-spec: true
approved:
  date: 2026-11-19
  baseline: def39c6
---
# Finding fates on the pull request

This is the third and last of the three plans of the spec finding-ids-and-fates (q-plans `three-plans`). It covers the pull-request side: §5.21 to §5.25, §5.26 and §5.27 where plans 1 and 2 did not prove them, the §6 surfaces "run pull request description — findings section" and "run pull request comment", and the criteria plan 2 left: AC-pr-section, AC-pr-description-not-rewritten, AC-pr-fix-pushes-and-comments, AC-pr-dismiss-defer-comment, AC-pr-no-pr, AC-publish-auto-off, AC-list-local and AC-never-blocks.

When phax creates a run's pull request, its description gains a `## Review findings` section. It names every open and deferred finding of the run and counts the fixed and dismissed ones, as `phax finding list` reads them at that moment. The description is never rewritten afterwards. Once the pull request exists and `publish.auto` is on, `phax finding fix`, `dismiss` and `defer` post one comment per finding they settle. `fix` first pushes the run branch, so the commit a comment names is visible on the pull request. With no pull request yet, or with `publish.auto` off, the fate commands stay local, as plan 2 left them. A new `phax finding post <run> <id>…` posts the comments of findings already settled. It writes no record, so it is the retry when a push or a comment fails, and it never records a fate twice.

Criteria this plan proves:
- Through the first acceptance pair (phase-03, passed by phase-04): AC-pr-section and AC-pr-no-pr.
- In-phase in phase-04: AC-never-blocks (publication).
- Through the second acceptance pair (phase-06, passed by phase-07): AC-pr-fix-pushes-and-comments, AC-pr-description-not-rewritten and AC-pr-dismiss-defer-comment.
- In-phase in phase-07: AC-publish-auto-off and AC-list-local. Both already hold before this plan, so they are regression tests, not frozen acceptance tests.

No persisted format changes. `publication.json`, `finding-list` and `finding-fate-record-manifest` keep their shapes and stamps. The `--json` answers of the fate commands and of `finding post` are command contracts with no `$schema`, as plan 2 decided.

Tests build their repositories, run worktrees, records branches and bare remotes as temporary git repositories, isolated with `isolateGit` and `isolatePhaxHome`. GitHub is stood in for by the fake port (`makeFakeGitHub`, through `makePublishPrCommand`), or by a made-up `gh` script placed first on PATH that logs each call. No test reads a real `~/.phax`, a credential store, a real `gh` login or the global git config, and none reaches the network.

## Required commands

- `pnpm gen:usage-spec`
- `pnpm docs:cli`
- `pnpm test:unit`
- `pnpm test:property:deep`

Every command above already equals an entry of `security.agentCommands` in phax.json, so no security configuration change is needed. `pnpm gen:usage-spec` and `pnpm docs:cli` regenerate the usage spec, the CLI reference and the README's generated CLI list in each phase that adds a command or changes a help text. `pnpm test:property:deep <file>` runs the PR-body property file once at depth before phase-04 hands off. `pnpm test:unit` runs the unit tier alone while iterating.

## Technical arbitrations

- Plans 1 and 2 stand as amended by their review fixes (#239, #242). That covers the fate record layout and its reader (`src/app/findingFateRecords.ts`), the run naming (`resolveFindingRun`), the `review_open` rule for the commit-making `fix`, dismiss, defer and `fix --commit` running on any run whose records exist, and §5.8 read as the list's contract only. This plan changes none of them.
- How a fate command finds the run's pull request: from `publication.json` in the run folder only. It uses `pullRequestUrl` when `prStatus` is `created` or `exists`. An absent, undecodable or failed publication means no pull request. An archived run reads its archive folder's copy. A run whose folder is gone has no pull request, and nothing is posted. phax asks GitHub nothing to find a pull request, and a merged or closed one is commented like an open one, with no lookup of its state. Loss accepted: a pull request opened outside phax (by hand with `gh pr create`), or one whose run folder is gone, never gets a fate comment. Reviewers of a closed pull request may be notified of a late fate.
- Which branch `phax finding fix` pushes, and how. It pushes the run's final-phase branch (`info.finalPhaseBranch`), which is the branch publish pushed and the pull request's head. It pushes to `publish.remote` through the Git port's existing `pushBranch` (`git push --set-upstream <remote> -- <branch>`), from the run's final worktree. The push is plain, never forced. Only `fix` pushes, in its path form and in its `--commit` form on a live run with a branch. `dismiss` and `defer` push nothing, and an archived run's `--commit` pushes nothing. With `publish.pushBranch: false`, `fix` pushes nothing and posts nothing, because its commit could not be visible; `dismiss` and `defer` still comment. When the remote branch has moved, git refuses the non-fast-forward push. phax then posts nothing for that call, keeps the commit and the records, and fails as described below. The fate commands never push `phax/records/v1`. Loss accepted: a fate's record reaches the remote only with `phax records sync` or a later publish, so a comment can name a fate whose record the remote does not hold yet.
- The comment (§5.23, §6). It is one `gh pr comment <pull-request-url> --body <text>` per finding settled, in the order named, run from the run's repository. The new port operation is `GitHub.commentOnPullRequest({ pullRequest, body, repo })`, and it answers the comment's URL. A fix naming several ids posts several comments. The text comes from the finding's latest fate record:
    - line 1 is `<id> <fate> — <location> — <message>`;
    - line 2 is `Fixed by <sha7> (<classes joined by ", ">)` for a fix, `Reason: <why>` for a dismissal, or ``Taken over by `<to>` `` for a deferral;
    - the location is a code span of `<file>:<line>` for a code-review finding, or the plain `<phaseId> <dimension>` for a compliance finding;
    - the message and the reason are on one line, with `@` mentions rendered as code.
    One failing comment does not stop the others. Loss accepted: N findings cost N `gh` calls and N notifications.
- When the push or a comment fails after the commit and the records landed (§5.20's sibling), the command keeps the commit and the records. It exits 1 with a new error, `FindingPullRequestNotUpdatedError`. Its `--json` fields are `{ message, pullRequest, commit, recorded, pushed, posted: [{ finding, url }], unposted, retry }`.
    - The text reads `✗ pull request not updated: …`. It names the pull request and git's or gh's first line. It says the fates are recorded and, for a fix, that the commit stays. It ends with `Retry with: phax finding post <run> <unposted ids>`.
    - After a refused push it also says to bring the remote's commits into the worktree without rewriting the fix (`git pull --no-rebase <remote> <branch>` in the worktree) before the retry.
    - A call whose records failed (`FindingFateNotRecordedError`, plan 2) pushes and posts nothing. Its `--commit` retry, or the same dismiss or defer again, posts once it records.
    Loss accepted: exit 1 now covers both a fate not recorded and a pull request not updated, and only the error tag tells them apart under `--json`. A caller that blindly reruns the fate command on exit 1 records a second, identical fate.
- The retry is a new verb, `phax finding post <run> <id>…`. It writes no record, so a retry never records a fate twice. Its steps:
    - It refuses an unknown id and a finding whose fate is `open` or `unrecorded`, since there is nothing to post.
    - It refuses a run with no pull request in `publication.json`.
    - It pushes the run branch first when a named finding is `fixed`, the run is live with its final worktree, and `publish.pushBranch` is on.
    - It posts one comment per named finding from its latest fate record.
    It ignores `publish.auto`, because it is an explicit request to post. The phase guard refuses it inside phase worktrees, like every fate command. Loss accepted: a fifth `finding` verb the spec does not name. It can also post a fate set before the pull request existed, a catch-up §7 keeps out of the fate commands themselves.
- The findings section in the description (§5.21, §6).
    - It is rendered by `src/domain/publish/prFindings.ts` from the findings as `listRunFindings` reads them when the pull request is created, so a re-review's earlier findings are included.
    - It replaces the `### Code review findings` subsection of `## Needs your review`. It sits as its own `## Review findings` section right after `## Needs your review` and before the review notes.
    - Layout: `Open (<n>)` then one line per open finding, a blank line, `Deferred (<n>)` then one line per deferred finding, a blank line, and the count line `Fixed: <n> · Dismissed: <n>`. ` · Unrecorded: <n>` is appended to the count line only when n > 0.
    - A finding line is `- <id> <severity> — <location> — <message>`. A deferred finding's line adds ``→ `<to>` ``. Locations are rendered as in the comment, and findings come in the list's order: F before C, each by number.
    - A block with no finding is left out. A run with no finding gets `No findings.` and no count line.
    - When the records branch could not be read, one line says so, and that every finding shows as open. When the findings cannot be read at all, one line names why and points to `phax finding list <run>`. A finding read never fails a publish.
    - Over the byte cap, the body cuts in this order: unexplained deviations, attention points, deferred findings, open findings, then review notes. A cut block keeps its `Open (<n>)` or `Deferred (<n>)` header with the full total, its first entries, and `- …and <k> more open finding(s)` (or `deferred finding(s)`). The count line is never cut.
    - `publishRun` reads the findings only when it creates a pull request. A reused pull request keeps its body, so its description is never rewritten.
    Loss accepted: a cut list drops the last findings in id order, not the least severe. A run published while its records are unavailable shows every finding as open.
- The fate commands' answers once they post. `fix`, `dismiss` and `defer` answer plan 2's contract object plus a required `pullRequest` field. It is either `{ kind: "not-posted", reason }`, with `reason` one of `publish-auto-off`, `no-pull-request` or `push-branch-off`, or `{ kind: "posted", url, pushed: { remote, branch, sha } | null, comments: [{ finding, url }] }`. `phax finding post` answers `{ run, pullRequest: <the posted shape without kind>, findings }`. The text adds `✓ pushed <branch> to <remote>` and one `✓ commented <id> on <url>` line per comment, and prints nothing for `not-posted`. Exits stay in the existing families: 0 on success, 1 for every refusal, a fate not recorded and a pull request not updated, 2 for a configuration error, and 64 for a call the runner refuses. Loss accepted: the answer's shape changes for scripts that read plan 2's answer, which is not a published format.
- Who may post. The fate commands and `finding post` stay refused by the phase guard inside phase worktrees (`src/domain/security/phaseGuard.ts`), so no phase agent gains a push or a GitHub call. Outside phases, a fate command pushes and posts only what `phax publish-pr` already pushes and posts for the same caller, and only when the operator has turned `publish.auto` on (§5.22, §5.23, decided in q-pr-refresh). This plan opens no new boundary.
- Two acceptance pairs. phase-03 freezes the description and is passed by phase-04. phase-06 freezes the fate commands' push and comments and is passed by phase-07. The acceptance tests reach phax only through the runner (`runnerCall`), through `makePublishPrCommand({ githubLayer })` for publication, and through a made-up `gh` on PATH for the fate commands. Phase-03's fixture `tests/fixtures/findings/prRunRepo.ts` serves both pairs, and phase-06 and phase-07 import it and never edit it. Every helper it exports is used by phase-03's own tests, because knip runs at every phase's gate. Loss accepted: the fixture phase-06 judges with is frozen by the first pair, not listed among the second pair's acceptance files.

---

## phase-01 — The findings section and the fate comment, rendered {#phase-01-findings-text}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

phax can render, from a run's findings and their fates, the `## Review findings` section of a pull request description and the text of one fate comment, deterministically and safe for GitHub Markdown. Nothing calls them yet.

### Detailed instructions

- Read the Technical arbitrations first: the findings section, the comment, and what is cut first. Read `src/domain/publish/prBody.ts` (`findingLine`, `withoutMentions`, `renderCutList`, `countLine`), `src/domain/reportText.ts` (`onOneLine`), `src/schemas/findingList.ts` (`CodeReviewFindingEntry`, `ComplianceFindingEntry`, the history entry variants), `src/cli/definitions/finding.ts` (`locationOf` and `fateDetails`), and `tests/unit/publish/prBody.test.ts`.
- Create `src/domain/publish/markdownSafe.ts`, pure. Move `withoutMentions` out of `prBody.ts` unchanged and export it. Export `codeSpan(text: string): string`, which is the fence rule `findingLine` applies today: a fence one backtick longer than the longest backtick run inside the text, padded with a space on each side when the text holds a backtick. In `src/domain/publish/prBody.ts`, import both and make `findingLine` use `codeSpan`. Its output must stay byte for byte the same, and `tests/unit/publish/prBody.test.ts` must pass unchanged.
- Create `src/domain/publish/prFindings.ts`, pure and importing only types from `src/schemas/findingList.ts`. Export `type PrFinding = CodeReviewFindingEntry | ComplianceFindingEntry` and the input type `PrFindings = { kind: "read"; records: "read" | "off" | "unavailable"; findings: readonly PrFinding[] } | { kind: "unreadable"; reason: string }`.
- In the same module, export `findingLocation(finding: PrFinding): string`. A code-review finding gives `codeSpan(onOneLine(`${file}:${line}`))`. A compliance finding gives the plain `<phaseId> <dimension>`.
- In the same module, export `splitPrFindings(findings)`, which answers `{ open: PrFinding[]; deferred: PrFinding[]; fixed: number; dismissed: number; unrecorded: number }`. `open` holds the findings whose fate is `open`, and `deferred` those whose fate is `deferred`, each in the order given.
- In the same module, export `renderPrFindingsSection(input: PrFindings, keep: { open: number; deferred: number }, shortName: string): string`. It answers exactly the layout of the Technical arbitrations. Its pieces:
    - Always the heading `## Review findings`, a blank line, then the body.
    - `unreadable`: one line, `The findings could not be read (<reason on one line, without mentions>): \`phax finding list <shortName>\` names the cause.`
    - No finding: `No findings.`
    - With `records: "unavailable"`, a first line: `The fates could not be read from phax/records/v1, so every finding shows as open: \`phax finding list <shortName>\` reads them again.`
    - The `Open (<n>)` block, its first `keep.open` lines, then `- …and <k> more open finding` (k = 1) or `findings` when cut. The block is left out when n = 0.
    - The `Deferred (<n>)` block, the same way with `deferred finding(s)`.
    - The count line `Fixed: <n> · Dismissed: <n>`, plus ` · Unrecorded: <n>` when that count is above 0.
    Blocks are separated by one blank line. A finding line is `- <id> <severity> — <findingLocation> — <withoutMentions(onOneLine(message))>`. A deferred line ends with `` → `<codeSpan(to)>` ``, where `to` is the finding's latest history entry's.
- Create `src/domain/findings/fateComment.ts`, pure. Export `renderFateComment(finding: PrFinding): string | null`. It answers null for a finding whose fate is `open` or `unrecorded`, or whose latest history entry does not match its fate. Otherwise it answers two lines joined by `\n`. Line 1 is `<id> <fate> — <findingLocation> — <withoutMentions(onOneLine(message))>`. Line 2 is one of:
    - `Fixed by <commit's first 7 characters> (<pathClasses joined by ", ">)`, from the latest entry;
    - `Reason: <withoutMentions(onOneLine(verdict.why))>`;
    - ``Taken over by <codeSpan(to)>``.
- Create `tests/unit/publish/prFindings.test.ts`, a table of `renderPrFindingsSection` cases, each against its full expected string:
    - the §6 example: F4 open, C1 open, F5 deferred, two fixed and one dismissed, which reads `Fixed: 2 · Dismissed: 1`;
    - no finding;
    - only fixed findings: no block and the count line;
    - an unrecorded finding, which adds ` · Unrecorded: 1`;
    - records unavailable;
    - unreadable;
    - `keep.open = 1` of three open findings, ending `- …and 2 more open findings`;
    - `keep.deferred = 0` of one, ending `- …and 1 more deferred finding`;
    - a message holding a newline and `@octocat`;
    - a file path holding a backtick.
    Also cover `splitPrFindings` and `findingLocation` for both sources.
- Create `tests/unit/findings/fateComment.test.ts`, a table of `renderFateComment` cases:
    - a fix with classes `[code, tests]`, which writes the 7-character sha;
    - a finding dismissed then fixed, which answers the fix;
    - a dismissal whose reason holds a newline;
    - a deferral to `docs/briefs/gate-retry-docs.md`;
    - a compliance finding's location;
    - an open and an unrecorded finding, which answer null.
    Add a short case for `codeSpan` and `withoutMentions` (the move must not change them) to the same file or to `tests/unit/publish/prFindings.test.ts`.

### Planned files to create

- `src/domain/publish/markdownSafe.ts`
- `src/domain/publish/prFindings.ts`
- `src/domain/findings/fateComment.ts`
- `tests/unit/publish/prFindings.test.ts`
- `tests/unit/findings/fateComment.test.ts`

### Planned files to edit

- `src/domain/publish/prBody.ts`

### Optional files that may be edited

- `src/domain/reportText.ts`
- `knip.json`
- `tests/unit/architecturalGuards.test.ts`

### Boundary contracts

Domain producers: `renderPrFindingsSection`, `splitPrFindings` and `findingLocation` (`src/domain/publish/prFindings.ts`), `renderFateComment` (`src/domain/findings/fateComment.ts`), and `codeSpan` and `withoutMentions` (`src/domain/publish/markdownSafe.ts`). Their consumers are `buildShortPrBody` (phase-04) and the posting use case (phases 05 and 07). Stable contract:
- input: the `finding-list` entries as `listRunFindings` answers them, fate and history included;
- output: the exact section and comment text the Technical arbitrations settle, pure and deterministic.

### Test strategy

- the findings section names open and deferred findings with their pointer and counts fixed and dismissed, in the settled layout — small · table · hand-written expected section strings · in-phase · AC-pr-section
- a kept-count below a block's total keeps its header total and the first entries, then one line counting the rest, and the count line always stays — small · boundary · expected strings at keep 0, 1 and the total · in-phase
- a fate comment names the finding, its new fate and what settles it: the fixing commit and classes, the reason, or the pointer — small · table · hand-written expected comment strings, null for open and unrecorded · in-phase · AC-pr-dismiss-defer-comment
- moving withoutMentions and the code-span fence out of prBody.ts changes no byte of the pull request body — small · example · the existing prBody unit tests, unchanged · in-phase

### Implementation order

1. markdownSafe.ts and the prBody.ts import
2. prFindings.ts and its table test
3. fateComment.ts and its table test

### Excluded scope

- Changing what the pull request body contains: phase-04.
- Any port, adapter or command: phases 02 to 07.
- Any persisted format.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exports of `src/domain/publish/markdownSafe.ts`, `src/domain/publish/prFindings.ts` and `src/domain/findings/fateComment.ts`, with their signatures. Show one rendered section (the §6 example) and one rendered comment of each fate. Confirm that `tests/unit/publish/prBody.test.ts` passes unchanged. Explain any deviation from the planned file lists.

### Commit subject

`feat(findings): render the pull request's findings section and fate comments`

### Commit body

Add the pure renderers the pull request side of finding fates needs:
the ## Review findings section of a description, naming open and
deferred findings and counting fixed and dismissed ones, with cut
blocks that keep their totals and a count line that always stays; and
the text of one fate comment, naming the finding, its new fate and the
commit, reason or pointer that settles it. withoutMentions and the
code-span fence move to a shared module, unchanged.

---

## phase-02 — Comment on a pull request through the GitHub port {#phase-02-github-comment}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

The GitHub port can post a comment on a pull request named by its URL. The `gh` adapter and the fake agree on it under one contract suite, which runs against a made-up `gh` on PATH and never against the real one.

### Detailed instructions

- Read the Technical arbitrations (the comment). Read `src/ports/github.ts`, `src/infra/github.ts` (`ghRun`, and how `createPullRequest` runs), `src/infra/fakes/github.ts` (`calls`, the `failNext…` pattern), and `tests/integration/githubRepoWebUrl.test.ts`, the contract suite style this phase follows: a made-up `gh` script first on PATH for the adapter, the fake for the other world.
- Add `commentOnPullRequest(input: { pullRequest: string; body: string; repo: string }): Effect.Effect<string, GitHubError>` to `GitHubOps` in `src/ports/github.ts`. Its doc comment says three things:
    - It posts one comment whose text is `body` on the pull request named by its URL.
    - It answers the comment's URL, which is gh's trimmed stdout, or the pull request's URL when gh prints nothing.
    - It fails with a GitHubError when gh fails or cannot run, carrying gh's stderr.
- Implement it in `NodeGitHubLayer` (`src/infra/github.ts`) as `ghRun(["pr", "comment", pullRequest, "--body", body], repo)`. Arguments go through `execFile` with no shell, so the body is passed verbatim, newlines and `$(…)` included. Never catch the failure: a comment that cannot be posted is a GitHubError.
- Implement it in `FakeGitHubImpl` (`src/infra/fakes/github.ts`). Add a call variant `{ method: "commentOnPullRequest"; pullRequest; body; repo }` and a `failNextComment(stderr)` that fails the next call with a GitHubError, like `failNextCreatePr`. A successful call answers `${pullRequest}#issuecomment-<n>`, with n counting the fake's successful comments from 1.
- Create `tests/integration/githubCommentContract.test.ts` in the style of `githubRepoWebUrl.test.ts`. A `describe.each` runs over the gh adapter and the fake. In both worlds:
    - posting answers a URL that starts with the pull request's URL;
    - a failing host gives a GitHubError.
    The adapter alone has three more cases:
    - The made-up gh exits 9 unless its arguments are exactly `pr comment <url> --body <body>`, for a body holding a newline, a backtick and `$(echo injected)`, and echoes `<url>#issuecomment-1`.
    - An empty stdout answers the pull request's URL.
    - On failure, the GitHubError's stderr holds gh's stderr line.
    The fake alone records the call with its body. Every gh script lives in a temporary directory removed after the test, and PATH is restored with `vi.unstubAllEnvs()`.

### Planned files to create

- `tests/integration/githubCommentContract.test.ts`

### Planned files to edit

- `src/ports/github.ts`
- `src/infra/github.ts`
- `src/infra/fakes/github.ts`

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Port: `GitHub.commentOnPullRequest` (`src/ports/github.ts`), produced by the `gh` adapter and the fake. Its consumers are the posting use case (phase-05) and, through it, the fate commands (phase-07). Stable contract: one comment per call on the pull request named by its URL, the body passed verbatim, the comment's URL (or the pull request's) as the answer, and a GitHubError carrying gh's stderr on failure.

### Test strategy

- the gh adapter and the fake agree on posting a comment and on failing with a GitHubError — medium · contract · one shared suite run against both, the adapter behind a made-up gh on PATH · in-phase
- the adapter passes the body verbatim as one argument, with no shell, and answers the pull request's URL when gh prints nothing — medium · example · the made-up gh's check of its exact argument list, and the answer · in-phase

### Implementation order

1. the port method
2. the gh adapter
3. the fake
4. the contract suite

### Excluded scope

- Calling the new operation from any use case: phases 05 and 07.
- Editing a pull request's description, or any other gh operation.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the signature and doc comment of `GitHub.commentOnPullRequest`, the exact gh arguments the adapter runs, the fake's call variant, `failNextComment`, and the URL the fake answers. Explain any deviation from the planned file lists.

### Commit subject

`feat(github): post a comment on a pull request`

### Commit body

The GitHub port gains commentOnPullRequest: one comment, its body passed
verbatim, on the pull request named by its URL, answering the comment's
URL. The gh adapter runs gh pr comment <url> --body <text> with no
shell; the fake records the call and can fail the next one. One contract
suite runs against both, the adapter behind a made-up gh on PATH.

---

## phase-03 — Acceptance tests of the findings section at pull request creation {#phase-03-pr-section-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** The fixture is new ground: a made-up gh on PATH that logs each call and the remote's head at comment time, a bare remote, and the run-folder files publish-pr needs. Its oracles must match how publishRun, reviewOnce and the fate commands already behave, which plan 2's acceptance phase got wrong twice. The default effort is not enough.
**Acceptance phase:** passed by phase-04
**Acceptance test files:** `tests/integration/prFindingsSection.test.ts`, `tests/fixtures/findings/prRunRepo.ts`

This phase writes, as frozen acceptance tests, what the description of a run's pull request must show when phax creates it: open and deferred findings named, fixed and dismissed counted, as they stand at creation, including fates set while no pull request existed. It also proves that those fate commands pushed and posted nothing. Each test fails today on its own assertion, because the description has no findings section yet. Phase-04 passes them.

### Detailed instructions

- Read the Technical arbitrations (the findings section, the acceptance pairs) and the handoffs of phases 01 and 02. Read these files before writing any expected value:
    - `tests/fixtures/findings/findingRunRepo.ts` and `tests/fixtures/findings/fateRunRepo.ts`: import them, never edit them. `reviewOnce` writes findings of severity `concern` at `src/reviewed.ts:7`, numbered F1 onwards.
    - `tests/integration/findingFix.test.ts` and `tests/integration/findingSettle.test.ts`: the `vi.mock("node:os")` hoisting, the working directory, `runnerCall`, every option before `--`.
    - `src/cli/definitions/publishPr.ts` (`makePublishPrCommand`) and `tests/integration/reviewCommandsJson.test.ts`: around its publish-pr cases, the run-folder files publication needs (`review-handoff.md`, `phase-01/file-reconciliation.json` and `.md`, the global reconciliation files).
    - `src/app/publishRun.ts`: the body file it hands `createPullRequest`.
- Write no stub and change no source file. Every test asserts on the description phax writes (`pr-body.md`, given to the fake's `createPullRequest`). Today it has no `## Review findings` section, so each test fails on that assertion, not on a missing module or export.
- Create `tests/fixtures/findings/prRunRepo.ts`, built on `buildFateRunRepo()`. It reads nothing outside its temporary directories, never names the opened version, and every export is used by this phase's tests. It exports these helpers.
- `buildPrRunRepo()`:
    - creates a bare repository in its own temporary directory;
    - adds it as `origin` in the main checkout and pushes the run branch to it;
    - writes into the run folder every file `phax publish-pr` needs to create a pull request, modelled on `tests/integration/reviewCommandsJson.test.ts`;
    - returns the `FateRunRepo` fields plus `remoteDir`.
    Its `cleanup` also removes the bare repository and the made-up gh, and calls `vi.unstubAllEnvs()`.
- Fixture helpers that change the project:
    - `setPublishAuto(repo, auto: boolean)` rewrites phax.json's `publish` key as `{ auto }`.
    - `writeComplianceFinding(repo, message: string)` writes the run folder's `compliance-review.json` through `complianceReviewFileText`. It holds one `phase-01` finding `{ id: "C1", dimension: "files", severity: "deviation", message }`, with verdict `conformant-with-deviations`.
- `installFakeGh(repo, mode: "answers" | "fails")` writes an executable `gh` shell script into a temporary bin directory and puts that directory first on PATH with `vi.stubEnv`. On every call the script:
    - writes its arguments, NUL-separated, to the next numbered file of a log directory;
    - for `pr comment`, also writes the bare remote's `refs/heads/<runBranch>` sha at that moment, from `git --git-dir <remoteDir> rev-parse --verify --quiet`.
    In `answers` mode a `pr comment` call echoes `<its third argument>#issuecomment-<n>` and exits 0, and any other call exits 1. In `fails` mode every call writes `gh: offline` to stderr and exits 1. Paths are baked into the script, so it reads no environment.
- Fixture helpers that read what happened:
    - `ghCalls(repo)` answers every logged call's arguments, in call order.
    - `ghComments(repo)` answers `{ pullRequest, body, remoteHeadAtCall }` for each `pr comment` call: its third argument, the argument after `--body`, and the logged remote sha (or null).
    - `remoteHead(repo)` answers the bare remote's `refs/heads/<runBranch>` sha, or null.
- `publishPr(repo)` runs `publish-pr <shortName> --json` through `runnerCall([makePublishPrCommand({ githubLayer: fake.layer })], …)`, with a `makeFakeGitHub()` and the real git adapter. It answers `{ code, out, err, prUrl, body }`, where `body` is the text of the file the fake's `createPullRequest` call was given, read after the call, or null when no pull request was created. `findingsSection(body: string): string | null` answers the lines from the line `## Review findings` up to (not including) the next line starting with `## ` or equal to `---`, trimmed. It answers null when there is no such heading.
- Create `tests/integration/prFindingsSection.test.ts`. Every test is its own `it.fails(...)`. Each builds a repo with `buildPrRunRepo()`, sets the working directory to `repoDir`, calls `installFakeGh(repo, "answers")` so no real gh can be reached, and calls the fate commands through `runnerCall([findingGroup], argv)` with `--by operator` and every option before `--`. AC-pr-section:
    - `setPublishAuto(repo, false)`, `reviewOnce` with five messages (F1 to F5), and `writeComplianceFinding(repo, "edited src/cli/ls.ts, not in the plan")` (C1).
    - Change `tests/gate.test.ts` and run `finding fix <run> F1 -- tests/gate.test.ts`. Change `src/app/gate.ts` and run `finding fix <run> F2 -- src/app/gate.ts`.
    - Run `finding dismiss <run> F3 --why "the second check guards --resume"` and `finding defer <run> F5 --to docs/briefs/gate-retry-docs.md --why "docs pass after the gate rework"`. Each of these calls exits 0.
    - `publishPr(repo)` exits 0, and `findingsSection(body)` is not null.
    - The section holds a line `Open (2)`, followed by exactly two lines starting `- F4 ` and `- C1 `, then a blank line. It holds a line `Deferred (1)`, followed by exactly one line starting `- F5 ` that contains `docs/briefs/gate-retry-docs.md`. It holds the line `Fixed: 2 · Dismissed: 1`.
    - No line of the section starts with `- F1 `, `- F2 ` or `- F3 `.
- Second test, AC-pr-no-pr. `setPublishAuto(repo, true)`, with no pull request, since no `publication.json` exists:
    - Run `reviewOnce` with five messages and note `remoteHead(repo)`.
    - Change `tests/gate.test.ts`, then run `finding fix <run> F2 -- tests/gate.test.ts`, `finding dismiss <run> F3 --why x` and `finding defer <run> F5 --to docs/briefs/gate-retry-docs.md --why y`. Each exits 0.
    - `ghCalls(repo)` and `ghComments(repo)` are empty, and `remoteHead(repo)` is unchanged.
    - `findingListJson(repo)` gives F2 `fixed`, F3 `dismissed` and F5 `deferred`.
    - Then `publishPr(repo)` exits 0. Its section holds `Open (2)` followed by lines starting `- F1 ` and `- F4 `, `Deferred (1)` followed by a line starting `- F5 ` with the pointer, and the line `Fixed: 1 · Dismissed: 1`.
- Reach phax only through the runner, `makePublishPrCommand` and the fixtures, never through a use case's internals. Pin nothing of the body beyond what each test names. Before adding the markers, check that `publishPr` exits 0 on the fixture today, so the only failing assertion is the section's. Run the gate and check that each marked test fails on its own assertion.

### Planned files to create

- `tests/fixtures/findings/prRunRepo.ts`
- `tests/integration/prFindingsSection.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-04's description at pull request creation, through `phax publish-pr` (`makePublishPrCommand`) over the fake GitHub port, and the fate commands of plan 2 through `findingGroup`. Consumer: these acceptance tests, through `runnerCall` with the working directory at the fixture's main checkout. Contract:
- `publish-pr <run>` exits 0 and hands `createPullRequest` a body file;
- the body holds a `## Review findings` section in the settled layout, from the run's findings and fates at creation;
- fate commands with no pull request push nothing and run no gh.

### Test strategy

- the description at creation names open F4 and C1 and deferred F5 with its pointer, and reads Fixed: 2 · Dismissed: 1 — medium · example · the Review findings section of the body file given to the fake createPullRequest · acceptance · AC-pr-section
- with publish.auto on and no pull request, fix, dismiss and defer record their fates, push nothing and run no gh, and the description written later carries those fates — medium · example · the made-up gh's call log, the bare remote's ref before and after, the finding-list answer, and the later body's section · acceptance · AC-pr-no-pr

### Implementation order

1. prRunRepo.ts, checked against publish-pr today
2. prFindingsSection.test.ts with a marker on each test
3. run the gate to see each marked test fail on its assertion

### Excluded scope

- Implementing the findings section (phase-04).
- Fate comments and the push of a fix (phases 05 to 07).
- Editing `tests/fixtures/findings/findingRunRepo.ts`, `tests/fixtures/findings/fateRunRepo.ts` or any source file.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test files.

### Expected handoff content

Give what `prRunRepo.ts` builds, every helper's signature, the made-up gh's two modes and its log format, and the run-folder files it writes for publication. For each acceptance test, give the assertion it fails on today. Confirm that every test carries its own `.fails` marker, that every fixture export is used by this phase's tests, that no test names the opened version, and that no source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(findings): acceptance tests for the findings section at pull request creation`

### Commit body

Freeze what a run's pull request description must show when phax
creates it: a Review findings section naming open and deferred findings,
the deferred one with its pointer, and counting fixed and dismissed ones,
as they stand at creation, including fates set while no pull request
existed, whose commands pushed nothing and ran no gh. A fixture adds a
bare remote, publish settings, publish-pr through the fake GitHub port
and a made-up gh on PATH that logs each call. Each fails today: the
description has no findings section yet.

---

## phase-04 — The findings section in the description at pull request creation {#phase-04-pr-section}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

When phax creates a run's pull request, at the run's end or through `phax publish-pr`, its description carries the `## Review findings` section. It is built from every finding of the run and its fate at that moment, cut last before the review notes, and never rewritten. Open findings never stop a publication. The acceptance tests of phase-03 pass.

### Detailed instructions

- Read the Technical arbitrations (the findings section, the acceptance pairs), phase-01's and phase-03's handoffs, and phase-03's two acceptance files. In `tests/integration/prFindingsSection.test.ts`, remove only the `.fails` markers. Change nothing else in it or in `tests/fixtures/findings/prRunRepo.ts`, and never retype a test's title.
- In `src/domain/publish/prBody.ts`:
    - Replace `ShortPrBodyInput.codeReview` with `findings: PrFindings` (`src/domain/publish/prFindings.ts`).
    - Remove the `### Code review findings` subsection of `## Needs your review`, and `findingLine` if nothing else uses it.
    - Render `renderPrFindingsSection(input.findings, keep, input.shortName)` as its own section right after `## Needs your review` and before the review notes.
    - Replace `Keep.findings` with `openFindings` and `deferredFindings`. Extend the cut so the order is: unexplained deviations, attention points, deferred findings, open findings, then review notes. Each stage runs only when emptying the lists before it was not enough, as today.
    - Update the module's doc comments, including the cut order in `buildShortPrBody`'s.
- In `src/app/publishRun.ts`:
    - Add a required `config: ResolvedConfig` to `PublishRunOpts`.
    - Replace `loadCodeReview` with a `loadPrFindings(info, config)` that runs `listRunFindings({ ref: runKey(info.namespace, info.shortName), config })`. It maps the answer to `{ kind: "read", records: document.records, findings: document.findings }`, and every failure to `{ kind: "unreadable", reason: <its message> }`, so a finding read never fails a publish.
    - Call it only on the path that creates a pull request. A reused one keeps its body.
    Pass `config` from both callers: `src/app/executePlan.ts` and `src/cli/definitions/publishPr.ts`. Grep for any other caller of `publishRun` (tests included) and pass it there too.
- Update the tests the change touches:
    - `tests/unit/publish/prBody.test.ts`: the code-review-findings cases become findings-section cases, and the cut cases now cover deferred before open findings and the count line kept in a fully cut body.
    - `tests/integration/publishRun.test.ts`: its fake file system holds no run phax can resolve, so its bodies now carry the unreadable line. Change only the expectations that named `### Code review findings` or the absence of a findings heading, and add one case that checks the unreadable line instead.
    - `tests/integration/headlessCodeReviewRunEnd.test.ts`: its `HEADING` becomes `## Review findings`, and the finding's expected line follows the settled layout.
    - `tests/integration/recordsPush.test.ts`: pass `config` to `publishRun`.
- Create `tests/unit/publish/prBody.property.test.ts` with fast-check on the project's fixed seed (see `docs/property-tests.md`). It generates finding lists of every fate, severity and source, with messages holding multibyte characters and newlines, and a `maxBytes` drawn between a small and a large cap. Four properties:
    - every body built from a non-empty list holds the count line;
    - a body never exceeds `maxBytes` whenever the fully cut body fits;
    - the open lines kept are a prefix, in order, of the open lines of the uncut body;
    - a body that fits uncut is not marked shortened.
    Run `pnpm test:property:deep tests/unit/publish/prBody.property.test.ts` once and record the seed and the result.
- Create `tests/integration/prFindingsPublish.test.ts`, in-phase, with the fixtures imported and never edited:
    - AC-never-blocks: `buildPrRunRepo()` and `writeCurrentReviews(repo)`, which gives an open `bug` F1, an open `concern` F2 and an open C1. `publishPr(repo)` exits 0 with a pull request URL, as it does on a second repo with no review. The body's Open block lists a line starting `- F1 bug `.
    - The second repo's section reads `No findings.`
    - A second `publishPr(repo)` on the first repo reuses the pull request and writes no new body file: the fake records one `createPullRequest`.

### Planned files to create

- `tests/unit/publish/prBody.property.test.ts`
- `tests/integration/prFindingsPublish.test.ts`

### Planned files to edit

- `src/domain/publish/prBody.ts`
- `src/app/publishRun.ts`
- `src/app/executePlan.ts`
- `src/cli/definitions/publishPr.ts`
- `tests/unit/publish/prBody.test.ts`
- `tests/integration/publishRun.test.ts`
- `tests/integration/headlessCodeReviewRunEnd.test.ts`
- `tests/integration/recordsPush.test.ts`
- `tests/integration/prFindingsSection.test.ts`

### Optional files that may be edited

- `src/domain/publish/prFindings.ts`
- `src/domain/publish/markdownSafe.ts`
- `tests/integration/reviewCommandsJson.test.ts`
- `knip.json`

### Boundary contracts

`publishRun` (app) consumes `listRunFindings` (`src/app/findingList.ts`) and the domain `buildShortPrBody` / `renderPrFindingsSection`. Its callers, `executePlan` and the `publish-pr` command, provide the resolved config. Stable contract toward the acceptance tests:
- a newly created pull request's body (`pr-body.md`, given to `createPullRequest`) holds the `## Review findings` section in the settled layout, from the run's findings and fates at that moment;
- a reused pull request's body is never written again;
- a finding read never fails a publish.

### Test strategy

- the body puts the findings section after Needs your review, cuts deferred then open findings after attention points and before notes, and keeps the count line — small · example · expected bodies and their shortened forms in the prBody unit tests · in-phase · AC-pr-section
- under any cap the body stays within it when the cut body fits, keeps the count line, and keeps open lines as an ordered prefix — small · property · byte length, the count line's presence and prefix order on generated finding lists, on the fixed seed · in-phase
- a run with open bug findings is published exactly as one with none, its pull request created — medium · example · publish-pr's exit code and pull request URL for both repos, and the Open block of the body · in-phase · AC-never-blocks
- a pull request that already exists gets no new body — medium · example · the fake GitHub's createPullRequest calls after two publishes · in-phase · AC-pr-description-not-rewritten
- the run-end code review's findings reach the description under Review findings — medium · example · the pr-body.md the run-end test reads · in-phase

### Implementation order

1. prBody.ts: the findings input, the section and the cut order
2. publishRun.ts: loadPrFindings and the config option
3. both callers
4. the unit, integration and property tests, then the deep run
5. remove the acceptance markers

### Excluded scope

- Rewriting an existing pull request's description, and posting comments (phases 05 to 07).
- Any change to publication.json or to the publish-pr command's answer.
- Editing `tests/fixtures/findings/prRunRepo.ts`, or anything but the markers in `tests/integration/prFindingsSection.test.ts`.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging that phase-03's acceptance tests now pass with their markers removed and nothing else changed.

### Expected handoff content

Give the new `ShortPrBodyInput.findings` and `Keep` shapes, the cut order as implemented, `PublishRunOpts.config`, and every caller updated. Show the findings section of one body. Give the seed and result of the `pnpm test:property:deep` run. Confirm that only the `.fails` markers changed in the acceptance test file and that the fixture is unchanged. Explain any deviation from the planned file lists.

### Commit subject

`feat(publish): list a run's findings by fate in its pull request description`

### Commit body

When phax creates a run's pull request, its description carries a
Review findings section in place of the code review findings list: every
finding of the run as phax finding list reads it, open and deferred ones
named, fixed and dismissed ones counted. Over the byte cap it cuts
deferred, then open findings after the attention points, and the count
line always stays. A finding read never fails a publish, and a reused
pull request keeps its body. The acceptance tests of the previous commit
pass.

---

## phase-05 — Post fate comments: phax finding post {#phase-05-finding-post}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** This phase designs the shared pull-request side of every fate command: where the pull request comes from, push then comment, partial failure, and a retry that must never record twice. It crosses the CLI, a use case, the Git port and the GitHub port, so the default effort is not enough.

The command `phax finding post <run> <id>…` pushes the run branch when a named finding is fixed, then posts one comment per named finding on the run's pull request, naming its fate and what settles it. It writes no record. It comes before the fate commands post on their own, so it can be their retry.

### Detailed instructions

- Read the Technical arbitrations (finding the pull request, the push, the comment, failures, the retry, the answers, who may post) and the handoffs of phases 01 to 04. Read these files:
    - `src/app/findingFix.ts` and `src/app/findingSettle.ts`: the refusal and not-recorded patterns;
    - `resolveFindingRun` and `listRunFindings` in `src/app/findingList.ts`;
    - `src/schemas/publication.ts` (`decodePublication`);
    - the Git port's `pushBranch` and `headCommit`;
    - `GitHub.commentOnPullRequest` (phase-02) and `renderFateComment` (phase-01);
    - `src/cli/definitions/finding.ts` and `src/domain/security/phaseGuard.ts`.
- Create `src/app/findingPullRequest.ts`, an Effect module over FileSystem, Git and GitHub. Export `FindingPullRequestNotUpdatedError`, a tagged error `{ message, pullRequest: string, commit: string | null, recorded: readonly string[], pushed: boolean, posted: readonly { finding: string; url: string }[], unposted: readonly string[], retry: string }`. Export the type `PullRequestPosted = { url: string; pushed: { remote: string; branch: string; sha: string } | null; comments: readonly { finding: string; url: string }[] }`.
- In the same module, export `readRunPullRequest(runFolder: string | null): Effect<string | null, never, FileSystem>`. It decodes `<runFolder>/publication.json` and answers `pullRequestUrl` when `prStatus` is `created` or `exists`. It answers null in every other case: no folder, no file, an undecodable file, or another status.
- In the same module, export `pushAndComment(input: { ref: string; run: ResolvedFindingRun; pullRequest: string; findings: readonly PrFinding[]; push: boolean; remote: string; recorded: readonly string[]; commit: string | null })`, answering `Effect<PullRequestPosted, FindingPullRequestNotUpdatedError, FileSystem | Git | GitHub>`. Its steps:
    1. When `push` is true and the run has a branch and an existing final worktree, run `git.pushBranch(runBranch, remote, worktree)`. A failure fails at once with `pushed: false`, nothing posted and every id unposted. The message names the branch, the remote and git's first stderr line. It says to run `git pull --no-rebase <remote> <branch>` in the worktree when the remote branch has moved, so the fix commit is not rewritten. The pushed sha is `git.headCommit(worktree)`.
    2. For each finding, in order, post `renderFateComment(finding)` with `commentOnPullRequest`, from the worktree when present, else the run target's `repoRoot`. A failure is collected and the rest are still posted.
    3. Any unposted id fails with `retry: phax finding post <ref> <unposted ids>`.
    The message is `✗ pull request not updated: <pull request>: <what failed>`. When `recorded` is not empty, it says `the fates of <ids> are recorded`, and when `commit` is not null, `the commit <sha7> stays`. It ends with `Retry with: <retry>`. Use `gitFailureLine` for git and gh lines.
- Create `src/app/findingPost.ts`, exporting `postFindings(input: { ref: string; operands: readonly string[]; config: ResolvedConfig })`. Every refusal is a `FindingPostRefusedError` (`{ message }`) made before any push or call. The steps, in order:
    1. Every operand must satisfy `isFindingId`, else refuse naming it. At least one is required, and ids are deduplicated in order.
    2. `resolveFindingRun`.
    3. `listRunFindings`. Refuse naming every id the run does not have. Refuse each id whose fate is `open` or `unrecorded`, for example `F4 is open: it has no fate to post`.
    4. `readRunPullRequest(run.runFolder)`. Null refuses with `<short-name> has no pull request phax opened (no publication.json with its URL in the run folder): nothing to post`.
    5. Push when a named finding is `fixed`, the run has a branch and a final worktree, and `config.publish.pushBranch` is true.
    6. `pushAndComment` with `recorded: []` and `commit: null`.
    It ignores `publish.auto` and writes no record. It answers `{ run: { namespace, shortName, runId, state }, pullRequest: PullRequestPosted, findings }`, where `findings` holds the named findings' entries.
- In `src/cli/definitions/finding.ts`, add the `post` command to `findingGroup`:
    - args as `dismiss` declares them (the run, then ids), and no flags;
    - output: a module-level, non-exported `PullRequestPostedOutput` schema (`{ url, pushed: NullOr({ remote, branch, sha }), comments: Array({ finding, url }) }`) inside a `FindingPostOutput`, `{ run, pullRequest, findings }`;
    - exits: `FindingPostRefusedError` 1, `FindingPullRequestNotUpdatedError` 1 with its own fields, `FindingRunRefError` 1, `FindingReviewUnreadableError` 1, `FindingFateRecordUnreadableError` 1, `GitError` 1, `FsError` 1, `RegistryCorruptionError` 1, `ConfigValidationError` 2;
    - texts: `✗ post refused: <message>`, and the not-updated error's own message;
    - layers: the repo-rooted file system, `NodeGitLayer` and `NodeGitHubLayer`;
    - the render prints `✓ pushed <branch> to <remote>` when it pushed, then `✓ commented <id> on <pull request url>` per comment;
    - help: posts the comments of findings already settled, pushes the run branch first for a fixed one, writes no record, ignores publish.auto, needs the pull request phax opened, and is the retry a fate command names when it could not update the pull request;
    - examples: `phax finding post gate-retry F2` and `phax finding post gate-retry F3 F5`.
    Update the group's summary if it no longer fits.
- Classify `"finding post": "refused"` in `src/domain/security/phaseGuard.ts`. Add `{ command: "finding post", provedBy: "tests/integration/findingPost.test.ts" }` to `tests/integration/everyCommandJson.test.ts`, and `finding post` to the list of `tests/integration/usageSpecDeclarations.test.ts`. Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated CLI list.
- Create `tests/integration/findingPost.test.ts`, with `prRunRepo.ts`, `fateRunRepo.ts` and `findingRunRepo.ts` imported and never edited, and the runner. Every test turns `publish.auto` off, so the fate commands it calls post nothing on their own, now and once phase-07 lands. Cases:
    - Create the pull request with `publishPr`, install the made-up gh in `answers` mode, change `tests/gate.test.ts` and fix F2. Note the records head, then run `finding post <run> F2`. It exits 0. The remote's head equals the run branch's head, and there is one comment on the pull request URL, naming `F2 fixed` and the 7-character sha. Its `remoteHeadAtCall` equals the new head, and the records branch head is unchanged.
    - Dismiss F3, then `finding post <run> F3`: one comment naming `F3 dismissed` and the reason.
    - Each is refused with exit 1 and no gh call: an open F4 (named), an unknown F9, and no `publication.json` (the file removed).
    - The made-up gh in `fails` mode: `finding post <run> F2` exits 1, and stderr contains `phax finding post <short-name> F2`. The records head is unchanged.
    - Remote moved: a commit pushed to the bare remote's branch from a temporary clone, then `finding post <run> F2` for a fixed F2. It exits 1, with no comment, and stderr names `git pull --no-rebase`.
    - The `--json` answer decodes as `{ run, pullRequest, findings }`, and the not-updated error's `--json` carries its fields.
    Extend `tests/unit/cli/findingFate.test.ts` with the text a post answer renders, with and without a push.

### Planned files to create

- `src/app/findingPullRequest.ts`
- `src/app/findingPost.ts`
- `tests/integration/findingPost.test.ts`

### Planned files to edit

- `src/cli/definitions/finding.ts`
- `src/domain/security/phaseGuard.ts`
- `tests/unit/cli/findingFate.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `tests/integration/usageSpecDeclarations.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `src/app/findingList.ts`
- `src/domain/findings/fixCall.ts`
- `tests/unit/security/phaseGuard.test.ts`
- `docs/cli/inventory.md`
- `knip.json`
- `tests/unit/commandLibrary/commander/catalogue.test.ts`
- `tests/integration/rootHelp.test.ts`

### Boundary contracts

The CLI layer calls one use case, `postFindings` (`src/app/findingPost.ts`), and renders its answer. It holds no business logic. The use case uses `resolveFindingRun` and `listRunFindings`, and the new shared `src/app/findingPullRequest.ts`: `readRunPullRequest`, `pushAndComment` and `FindingPullRequestNotUpdatedError`. That module crosses the Git port (`pushBranch`, `headCommit`), the GitHub port (`commentOnPullRequest`) and the domain (`renderFateComment`). Phase-07 reuses `findingPullRequest.ts` for the fate commands, and its retry names `phax finding post`. Stable contract:
- `finding post <run> <id>…` writes no record;
- it pushes before it posts when a named finding is fixed;
- it posts one comment per id in order;
- it exits 0, or 1 for a refusal or a pull request not updated.

### Test strategy

- post pushes the run branch before it comments on a fixed finding, posts one comment naming the fate and the commit, and writes no record — medium · example · the bare remote's head, the made-up gh's comment log with the remote head at call time, and the records branch head · in-phase · AC-pr-fix-pushes-and-comments
- post refuses an open, unknown or prPR-less call before any push or gh call — medium · example · exit code 1, the stderr text and an empty gh log · in-phase
- a failed comment or a refused push leaves the records untouched and names the post retry and, for a moved remote, git pull --no-rebase — medium · example · exit code 1, stderr, the records branch head and the comment log · in-phase
- post answers render their pushed and commented lines — small · example · the expected text lines · in-phase
- the usage spec, the CLI reference, the every-command JSON table and the phase guard hold phax finding post — small · example · the usage, CLI-reference, every-command and phase-guard drift tests · in-phase

### Implementation order

1. readRunPullRequest and FindingPullRequestNotUpdatedError
2. pushAndComment
3. postFindings with its refusals
4. the post command, its render, exits and help
5. the phase guard, gen:usage-spec, docs:cli and the cross-command tables
6. the integration and render tests

### Excluded scope

- Posting from `phax finding fix`, `dismiss` or `defer` (phase-07).
- Looking a pull request up on GitHub, or editing its description.
- Pushing `phax/records/v1`.
- Editing any fixture or acceptance test file.

### Verification

The `standard` gate profile in phax.json.

### Expected handoff content

Give the exports of `src/app/findingPullRequest.ts` and `src/app/findingPost.ts` with their signatures, the exact not-updated and refusal wordings, the retry text, and the `post` answer's shape. Say from which directory the push and the comments run. Confirm the phase guard classification and that `phax.usage.kdl`, `docs/cli/reference.md` and the README's generated list were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(cli): add phax finding post`

### Commit body

phax finding post <run> <id>… posts one comment per named finding on
the run's pull request, naming its fate and the commit, reason or
pointer that settles it, after pushing the run branch when a named
finding is fixed. It writes no record, so it is the retry when a fate
command could not update the pull request, and never records a fate
twice. The pull request is the one publication.json names; a refused push
or a failed comment exits 1 naming what is left to post. The phase guard
refuses it in phase worktrees.

---

## phase-06 — Acceptance tests of fate comments from fix, dismiss and defer {#phase-06-fate-comments-acceptance}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium
**Acceptance phase:** passed by phase-07
**Acceptance test files:** `tests/integration/findingPullRequest.test.ts`

This phase writes, as frozen acceptance tests, what the fate commands must do once the run has a pull request and `publish.auto` is on. `phax finding fix` pushes the run branch and then posts one comment per finding, naming the fixing commit, which is already on the remote. `dismiss` and `defer` post their comment with the reason or the pointer. The description stays as it was written. Each test fails today on its own assertion, because the fate commands post nothing. Phase-07 passes them.

### Detailed instructions

- Read the Technical arbitrations (the push, the comment, the acceptance pairs) and the handoffs of phases 03 to 05. Read `tests/fixtures/findings/prRunRepo.ts`, `fateRunRepo.ts` and `findingRunRepo.ts`: import them, never edit them. Read `tests/integration/prFindingsSection.test.ts` and `tests/integration/findingPost.test.ts` for the setup. Check every expected value against the fixture and its helpers before writing it.
- Write no stub and change no source file. Every test asserts on the made-up gh's comment log or the bare remote's head. Today the fate commands neither push nor run gh, so each test fails on that assertion.
- Create `tests/integration/findingPullRequest.test.ts`. Every test is its own `it.fails(...)`. Each builds a repo with `buildPrRunRepo()`, sets the working directory to `repoDir`, and seeds findings with `reviewOnce`. It creates the pull request with `publishPr(repo)` (exit 0, `prUrl` noted), then calls `setPublishAuto(repo, true)` and `installFakeGh(repo, "answers")`. Fate commands run through `runnerCall([findingGroup], argv)`, with `--by operator` and every option before `--`.
- AC-pr-fix-pushes-and-comments: five findings. Change `tests/gate.test.ts`, then run `finding fix <run> F2 -- tests/gate.test.ts`. It exits 0, and the run branch's new head is H.
    - `remoteHead(repo)` equals H.
    - `ghComments(repo)` has exactly one entry. Its `pullRequest` equals `prUrl` and its `remoteHeadAtCall` equals H.
    - Its body contains `F2`, `fixed` and H's first 7 characters.
- One comment per finding: five findings. Change `tests/gate.test.ts`, then run `finding fix <run> F2 F5 -- tests/gate.test.ts`. It exits 0, and there are exactly two comments: the first body contains `F2` and not `F5`, the second contains `F5`, and both contain the new head's first 7 characters.
- AC-pr-description-not-rewritten: five findings. Before the fix, read the run folder's `pr-body.md` and check that its `findingsSection` lists a line starting `- F4 ` under `Open (5)`. Change `src/app/gate.ts`, then run `finding fix <run> F4 -- src/app/gate.ts`. It exits 0.
    - `pr-body.md` is byte for byte unchanged.
    - Every logged gh call's first two arguments are `pr comment`, so there is no edit of the description.
    - Exactly one comment, whose body contains `F4` and `fixed`.
- AC-pr-dismiss-defer-comment: five findings. Note `remoteHead(repo)`. Then run `finding dismiss <run> F3 --why "the second check guards --resume"` and `finding defer <run> F5 --to docs/briefs/gate-retry-docs.md --why "docs pass after the gate rework"`. Each exits 0.
    - There are exactly two comments, in that order.
    - The first contains `F3`, `dismissed` and `the second check guards --resume`.
    - The second contains `F5`, `deferred` and `docs/briefs/gate-retry-docs.md`.
    - `remoteHead(repo)` is unchanged.
- Reach phax only through the runner and the fixtures. Pin no comment layout beyond what each test names. Run the gate and check that each marked test fails on its own assertion.

### Planned files to create

- `tests/integration/findingPullRequest.test.ts`

### Planned files to edit

- (none)

### Optional files that may be edited

- `knip.json`

### Boundary contracts

Producer: phase-07's `fix`, `dismiss` and `defer` in `findingGroup`, with the real git adapter and the gh adapter behind the made-up gh. Consumer: these acceptance tests, through `runnerCall`, with the pull request created by `publish-pr` over the fake GitHub port. Contract:
- with a pull request in `publication.json` and `publish.auto` on, `fix` pushes the run branch before it runs `gh pr comment`;
- each fate command posts one comment per finding, in the order named, naming the fate and the commit, reason or pointer;
- `pr-body.md` and the description are never touched.

### Test strategy

- a fix pushes the run branch, then posts one comment for F2 naming fixed and the commit, which the remote already holds — medium · example · the bare remote's head, and the comment log's pull request, body and remote head at call time · acceptance · AC-pr-fix-pushes-and-comments
- a fix naming F2 and F5 posts one comment per finding, in the order named — medium · example · the comment log's bodies in order · acceptance · AC-pr-fix-pushes-and-comments
- a fix after the pull request opened leaves the description as written, still listing F4 open, and reaches the pull request as a comment — medium · example · pr-body.md before and after, the gh call log holding only pr comment calls, and the one comment · acceptance · AC-pr-description-not-rewritten
- a dismissal and a deferral each post one comment naming the fate and the reason or the pointer, and push nothing — medium · example · the comment log's bodies and the bare remote's head before and after · acceptance · AC-pr-dismiss-defer-comment

### Implementation order

1. findingPullRequest.test.ts with a marker on each test
2. run the gate to see each marked test fail on its assertion

### Excluded scope

- Implementing the posting from fate commands (phase-07).
- Offline and failure behaviour, which phase-07 tests in-phase.
- Editing any fixture or source file.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging the acceptance test file.

### Expected handoff content

For each acceptance test, give the assertion it fails on today. Confirm that every test carries its own `.fails` marker, that no test names the opened version, and that no fixture or source file changed. Explain any deviation from the planned file lists.

### Commit subject

`test(findings): acceptance tests for fate comments on the pull request`

### Commit body

Freeze what the fate commands must do once a run's pull request exists
and publish.auto is on: phax finding fix pushes the run branch, then
posts one comment per finding naming the fixing commit, already on the
remote; dismiss and defer post theirs with the reason or the pointer;
the description stays as it was written. Each fails today: the fate
commands neither push nor post.

---

## phase-07 — Fix, dismiss and defer update the pull request {#phase-07-fate-commands-post}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** high
**Assignment reason:** This phase wires the pull-request side into three commands that must keep plan 2's frozen behaviour and satisfy phase-06's frozen tests. It must also get offline, failure and retry semantics right across git, gh and the records branch. The default effort is not enough.

When the run has a pull request and `publish.auto` is on, `phax finding fix`, `dismiss` and `defer` reach it after their records land. `fix` pushes the run branch, then each command posts one fate comment per finding it settles. With `publish.auto` off or no pull request yet, they stay local and offline. A failed push or comment keeps the commit and the records, exits 1 and names `phax finding post`. The acceptance tests of phase-06 pass.

### Detailed instructions

- Read the Technical arbitrations (every point), the handoffs of phases 05 and 06, and phase-06's acceptance file. In `tests/integration/findingPullRequest.test.ts`, remove only the `.fails` markers, change nothing else, and never retype a test's title. Never edit the fixtures. Read `src/app/findingPullRequest.ts` and `src/app/findingPost.ts` (phase-05), `src/app/findingFix.ts`, `src/app/findingSettle.ts` and `src/cli/definitions/finding.ts`.
- In `src/app/findingPullRequest.ts`, export the type `PullRequestOutcome = { kind: "not-posted"; reason: "publish-auto-off" | "no-pull-request" | "push-branch-off" } | ({ kind: "posted" } & PullRequestPosted)`. Also export `pullRequestAfterFates(input: { ref; run: ResolvedFindingRun; verb: "fix" | "dismiss" | "defer"; findings: readonly PrFinding[]; recorded: readonly string[]; commit: string | null; config: ResolvedConfig })`, answering `Effect<PullRequestOutcome, FindingPullRequestNotUpdatedError, FileSystem | Git | GitHub>`. Its steps, in order:
    1. `config.publish.auto` false answers `not-posted` / `publish-auto-off`, before reading anything.
    2. `readRunPullRequest(run.runFolder)` null answers `no-pull-request`.
    3. For `fix`, `config.publish.pushBranch` false answers `push-branch-off`.
    4. Otherwise `pushAndComment` (push only for `fix`), answering `posted`.
- In `src/app/findingFix.ts`, after every record succeeded, call `pullRequestAfterFates` with the named findings read after the write, `recorded`, and the commit's sha. Add the outcome to the answer as `pullRequest`, and `FindingPullRequestNotUpdatedError` to `FindingFixError`. A call whose records failed still fails with `FindingFateNotRecordedError` and pushes and posts nothing. The requirement gains GitHub. Update the header comment: the command no longer pushes nothing; it reaches the pull request as the Technical arbitrations say.
- In `src/app/findingSettle.ts`, make the same change for `dismiss` and `defer` (`commit: null`, no push), and update the header comment.
- In `src/cli/definitions/finding.ts`:
    - Add `pullRequest` to `FindingFixOutput`, a union of `{ kind: "not-posted", reason }` and phase-05's posted schema with `kind: "posted"`, and keep the schema shared by the three commands.
    - Add `FindingPullRequestNotUpdatedError` (exit 1, its own fields, its message as text) to `fix`'s exits, errors and texts, and to the shared settle ones.
    - Provide `NodeGitHubLayer` in the fix and settle layers.
    - The three renders append `✓ pushed <branch> to <remote>` when pushed and one `✓ commented <id> on <url>` per comment. They append nothing for `not-posted`.
    - Rewrite the help sentences that say the commands push nothing and call no GitHub. With publish.auto on and a pull request phax opened, fix pushes the run branch (never forced) and each command posts one comment per finding. With publish.auto off or no pull request, nothing leaves the machine. A failed push or comment keeps the fates, exits 1 and names phax finding post. The records branch is never pushed.
    Run `pnpm gen:usage-spec` and `pnpm docs:cli`, and commit what they change.
- Create `tests/integration/findingPullRequestLocal.test.ts`, in-phase, with the fixtures imported and never edited:
    - AC-publish-auto-off: create the pull request with `publishPr`, keep `publish.auto` off, and install the made-up gh in `fails` mode. Then fix F2 (a change in `tests/gate.test.ts`), dismiss F3 and defer F5, each with `--json`. Each exits 0, the remote head is unchanged and the gh log is empty. Each answer's `pullRequest` is `{ kind: "not-posted", reason: "publish-auto-off" }`, and the fates are recorded.
    - AC-list-local: a pull request exists, `publish.auto` is on, and the made-up gh answers. `finding list <run>` and `finding list <run> --json` exit 0 with an empty gh log.
    - Remote moved: a pull request exists, `publish.auto` is on, and a commit was pushed to the bare remote's branch from a temporary clone. `finding fix <run> F2 -- tests/gate.test.ts` exits 1 with `FindingPullRequestNotUpdatedError` under `--json`, and there is no comment. The list gives F2 `fixed`, the commit is on the run branch, and stderr names `git pull --no-rebase` and `phax finding post <short-name> F2`.
    - Comment fails: a pull request exists, `publish.auto` is on, and the made-up gh is in `fails` mode. `finding dismiss <run> F3 --why x` exits 1, F3 is `dismissed`, and the retry is named. Then the made-up gh in `answers` mode and `finding post <run> F3` post one comment and leave the records head unchanged, so the retry records nothing twice.
    - Record failure: a pull request exists, `publish.auto` is on, and `lockRecordsBranch`. `finding fix` exits 1 with `FindingFateNotRecordedError`, the gh log is empty and the remote head is unchanged.
    - `--commit`: a pull request exists and `publish.auto` is on. `finding fix <run> F3 --commit <an earlier run-branch commit>` posts one comment naming that commit.
    - `publish.pushBranch: false`: fix answers `push-branch-off` with no push and no comment, and dismiss still posts its comment.
    Write phax.json's `publish` key in the test itself where the fixture's `setPublishAuto` does not cover it.
- Extend `tests/unit/cli/findingFate.test.ts` with the lines a fix, dismiss and defer answer render when posted, and the absence of a line when not posted. Run plan 2's `tests/integration/findingFix.test.ts`, `findingSettle.test.ts`, `findingFixPaths.test.ts` and `findingSettleRuns.test.ts`: their projects have no `publish` key, so they must pass unchanged. If one compares a whole answer and now misses `pullRequest`, update only that expectation in a file that is not an acceptance file, and say so in the handoff.

### Planned files to create

- `tests/integration/findingPullRequestLocal.test.ts`

### Planned files to edit

- `src/app/findingPullRequest.ts`
- `src/app/findingFix.ts`
- `src/app/findingSettle.ts`
- `src/cli/definitions/finding.ts`
- `tests/integration/findingPullRequest.test.ts`
- `tests/unit/cli/findingFate.test.ts`
- `phax.usage.kdl`
- `docs/cli/reference.md`
- `README.md`

### Optional files that may be edited

- `src/app/findingPost.ts`
- `src/app/findingList.ts`
- `tests/integration/findingFixPaths.test.ts`
- `tests/integration/findingSettleRuns.test.ts`
- `tests/integration/everyCommandJson.test.ts`
- `docs/cli/inventory.md`
- `knip.json`

### Boundary contracts

The CLI layer still calls one use case per command (`fixFindings`, `dismissFindings`, `deferFindings`) and renders its answer. The use cases now call `pullRequestAfterFates` (`src/app/findingPullRequest.ts`), which reaches the Git port's `pushBranch` and the GitHub port's `commentOnPullRequest` only when `publish.auto` is on and `publication.json` names a pull request. Stable contract toward the acceptance tests:
- `fix` pushes the run branch, then comments;
- each command posts one comment per finding in the order named;
- no description edit;
- exit 0, or 1 for a refusal, a fate not recorded, or a pull request not updated whose retry is `phax finding post`.

### Test strategy

- with publish.auto off, fix, dismiss and defer make no push and no gh call, record their fates and answer not-posted publish-auto-off — medium · example · an empty gh log from a gh that only fails, the bare remote's head, the answers and the finding list · in-phase · AC-publish-auto-off
- finding list makes no GitHub call while a pull request exists and publish.auto is on — medium · example · an empty gh log after the text and --json list · in-phase · AC-list-local
- a refused push or a failed comment keeps the commit and the fates, exits 1, and names the post retry, which then posts without recording again — medium · example · exit codes, error tag, stderr, the finding list, the comment log and the records branch head · in-phase
- a fate whose record failed pushes and posts nothing — medium · example · an empty gh log and the bare remote's head · in-phase
- fix --commit posts its comment, and publish.pushBranch false stops fix from pushing or posting while dismiss still posts — medium · example · the comment log, the remote head and the answers' pullRequest · in-phase
- fate answers render their pushed and commented lines, and nothing when not posted — small · example · the expected text lines · in-phase

### Implementation order

1. PullRequestOutcome and pullRequestAfterFates
2. fixFindings, dismissFindings and deferFindings
3. the output schema, exits, layers, renders and help
4. gen:usage-spec and docs:cli
5. remove the acceptance markers
6. the in-phase tests, then plan 2's tests

### Excluded scope

- Rewriting the description, or posting from `phax publish-pr`.
- Looking a pull request up on GitHub.
- Pushing `phax/records/v1`.
- Editing any fixture, or anything but the markers in `tests/integration/findingPullRequest.test.ts`.

### Verification

The `standard` gate profile in phax.json, with the configured acceptance provider judging that phase-06's acceptance tests now pass with their markers removed and nothing else changed.

### Expected handoff content

Give `pullRequestAfterFates`'s signature, the `pullRequest` answer shape, the new exits of the three commands, and the help sentences as they now read. Show the text of a fix that pushed and commented, and the not-updated message of a moved remote. Confirm that only the `.fails` markers changed in the acceptance test file, that the fixtures are unchanged, that plan 2's tests pass (naming any expectation updated), and that the usage spec, CLI reference and README list were regenerated. Explain any deviation from the planned file lists.

### Commit subject

`feat(findings): post fate comments from fix, dismiss and defer`

### Commit body

When a run's pull request exists and publish.auto is on, phax finding
fix pushes the run branch, plainly, then posts one comment per finding
it fixes, naming the commit; dismiss and defer post theirs with the
reason or the pointer. With publish.auto off or no pull request yet,
nothing leaves the machine. A refused push or a failed comment keeps the
commit and the records, exits 1 and names phax finding post as the retry.
The answers carry what was pushed and posted. The acceptance tests of
the previous commit pass.

---

## phase-08 — Docs: findings on the pull request {#phase-08-pr-docs}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium

An operator with a `review_open` run can read on `docs/findings.md` what reaches the pull request. The description lists the findings by fate when phax creates it. Each fate set afterwards arrives as a comment when `publish.auto` is on. The page also covers what happens offline, with `publish.auto` off or with no pull request yet, and how `phax finding post` retries. The README and the upgrading notes say the same.

### Detailed instructions

- Read spec §3, §6 and §11, the Technical arbitrations, and the handoffs of phases 01 to 07. Use the exact output, wordings and help those phases produced, and the example run `gate-retry`.
- Edit `docs/findings.md`. Add a section `## On the pull request`:
    - The description written when phax creates the run's pull request: the §6 findings section example, open and deferred named, fixed and dismissed counted, ` · Unrecorded: n` when present, and what is cut first when it is too long. It is written once and never rewritten.
    - Fate comments: the §11 example. With `publish.auto` on and a pull request phax opened, `fix` pushes the run branch (plainly, never forced), then each command posts one comment per finding. Show one comment of each fate.
    - Which pull request: the one `publication.json` names. A merged or closed one is still commented, and one opened by hand is not.
    - With `publish.auto` off: nothing leaves the machine, so the commands work offline. With no pull request yet: nothing is pushed or posted, and the description carries the fates when the pull request is created. With `publish.pushBranch` false: fix neither pushes nor posts.
    - When a push or a comment fails: the fates stay recorded, the command exits 1, and `phax finding post <run> <id>…` posts what is left without recording again. For a moved remote, pull with `--no-rebase` first.
    - `phax finding list` never calls GitHub, and findings never block completion, publication or merge.
- Also in `docs/findings.md`, replace the sentences of `## Fate records` that say a fate command pushes nothing and calls no GitHub, and that the pull request comes in a later release. The records branch is still never pushed by a fate command. Add `phax finding post` in a short paragraph with its example. Update `## Exit codes`: 0 also means the pull request was updated when that applies, and 1 adds a pull request not updated.
- README.md:
    - Next to the `phax finding` lines of the command list, add `phax finding post <run> <id>…  # post the comments of settled findings on the run's pull request (see docs/findings.md)`.
    - Where the README names `### Code review findings` in the pull request and its cut order, name the `## Review findings` section and the new cut order.
    - Do not edit the generated CLI list by hand: phases 05 and 07 regenerated it.
- docs/upgrading.md: in the top (opened) version section, add these bullets:
    - The pull request description's code review findings list is replaced by a Review findings section of every finding by fate.
    - With `publish.auto` on, `phax finding fix`, `dismiss` and `defer` now push and comment on the run's existing pull request, and `--json` answers gain `pullRequest`.
    - `phax finding post` is new.
    - No step is needed in a repository.

### Planned files to create

- (none)

### Planned files to edit

- `docs/findings.md`
- `README.md`
- `docs/upgrading.md`

### Optional files that may be edited

- `docs/json-output.md`
- `docs/cli/reference.md`
- `phax.usage.kdl`
- `tests/unit/site/pages.test.ts`

### Test strategy

- the findings page still builds on the docs site with its route, and its links resolve — medium · smoke · pnpm site:build at the terminal gate and the site's page tests · in-phase

### Implementation order

1. docs/findings.md
2. README lines
3. upgrading bullets

### Excluded scope

- Any code change.
- Editing generated CLI text by hand.

### Verification

The `standard` gate profile in phax.json, including its terminal `pnpm site:build`.

### Expected handoff content

List the sections of `docs/findings.md` as they now stand, and every other doc changed, with one line each. Explain any deviation from the planned file lists.

### Commit subject

`docs(findings): document findings on the pull request`

### Commit body

docs/findings.md now says what reaches a run's pull request: the
description lists its findings by fate when phax creates it and is never
rewritten; with publish.auto on, phax finding fix pushes the run branch
and fix, dismiss and defer post one comment per finding; with it off or
with no pull request yet, nothing leaves the machine; a failed push or
comment is retried with phax finding post. The README and the upgrading
notes say the same.
