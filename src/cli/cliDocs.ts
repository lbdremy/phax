export interface CliDocEntry {
  longHelp: string;
  examples: string[];
}

// Command-path-keyed long help and runnable examples for documentation-heavy
// commands. Keys are the full command path (space-separated), matching the
// Usage spec emitter's path convention: "run", "enter-phase", etc.
//
// This map is the single source of truth: both the runtime --help output
// (via program.ts) and the spec generator read it, so they never disagree.
export const cliDocs: Readonly<Record<string, CliDocEntry>> = {
  run: {
    longHelp:
      "Extracts a plan from the plan.md given by --plan, creates a run entry in the registry, and executes each phase sequentially in its own Git worktree using the configured AI agent. Each phase runs a gate profile after execution; the final phase worktree stays open for human review.\n\nExtraction results are cached by content hash under ~/.phax/cache/plans/; a repeated run of the same plan.md reuses the cached extraction without calling the LLM again. Use --refresh to force a fresh extraction.\n\nSide effects: creates worktrees, commits files, writes to ~/.phax/runs/.",
    examples: [
      "phax run --plan plan.md",
      "phax run my-feature --plan plan.md",
      "phax run --plan plan.md --dry-run",
      "phax run --plan plan.md --refresh",
    ],
  },

  resume: {
    longHelp:
      "Picks up a run from its next pending phase, re-entering the same execution loop as phax run. Prompts for confirmation before proceeding unless --yes is set.\n\nSide effects: creates worktrees, commits files, writes to ~/.phax/runs/.",
    examples: ["phax resume usage-cli", "phax resume usage-cli --yes"],
  },

  init: {
    longHelp:
      "Creates phax.json and phax.schema.json in the current directory. Use --force to overwrite an existing phax.json. Does not connect to any network or external service.",
    examples: ["phax init", "phax init --force"],
  },

  enter: {
    longHelp:
      "Attaches to the kept-open agent session in the final worktree, so you can review the agent's work, ask follow-up questions, or apply manual fixes interactively.",
    examples: ["phax enter usage-cli"],
  },

  "enter-phase": {
    longHelp:
      "Attaches to the agent session for a specific phase worktree. Useful for inspecting intermediate state or debugging a phase that has not yet been committed to main.",
    examples: ["phax enter-phase usage-cli phase-02"],
  },

  "session-info": {
    longHelp:
      "Prints diagnostic information about a run: its current state, active phase, worktree path, and agent session id. Read-only — no side effects.",
    examples: ["phax session-info usage-cli", "phax session-info usage-cli --debug"],
  },

  shell: {
    longHelp:
      "Opens an interactive shell in the final worktree. Useful for manually inspecting files, running tests, or executing commands outside the agent session.",
    examples: ["phax shell usage-cli"],
  },

  path: {
    longHelp:
      "Prints the absolute path to the final worktree on a single line. Useful in scripts: cd $(phax path my-run) or for piping to other tools.",
    examples: ["phax path usage-cli", "cd $(phax path usage-cli)"],
  },

  open: {
    longHelp:
      "Opens the final worktree in the editor configured in phax.json (or the EDITOR environment variable). Equivalent to running your editor with the worktree path as an argument.",
    examples: ["phax open usage-cli"],
  },

  ls: {
    longHelp:
      "Lists runs from the local registry (~/.phax/runs/). With no filter flags, shows all runs. Use status filters to narrow output: --active (created or running), --failed, --review-open (awaiting human review), or --archived. Use --json for machine-readable output.",
    examples: ["phax ls", "phax ls --review-open", "phax ls --failed --json"],
  },

  archive: {
    longHelp:
      "Archives a run by removing its worktrees and marking it archived in the registry. Without --force, fails when the final worktree has uncommitted changes.\n\nSide effects: deletes worktrees from the filesystem, updates ~/.phax/runs/.",
    examples: ["phax archive usage-cli", "phax archive usage-cli --force"],
  },

  "publish-pr": {
    longHelp:
      "Pushes the final worktree branch to the GitHub remote and creates a pull request, or reuses an existing PR for the same branch. Requires a GitHub remote and gh CLI authentication.\n\nSide effects: git push to remote, GitHub API call to create or update a pull request.",
    examples: ["phax publish-pr usage-cli"],
  },

  report: {
    longHelp:
      "Creates a GitHub issue from local run telemetry. By default, uploads the full log as a secret GitHub gist and links it in the issue body. Use --no-gist to inline the log directly.\n\nSide effects: GitHub API calls — creates a GitHub issue and, unless --no-gist is set, a secret gist.",
    examples: ["phax report", "phax report usage-cli", "phax report usage-cli --no-gist"],
  },

  "review-compliance": {
    longHelp:
      "Runs a non-mutating plan-compliance review by invoking the AI agent with the run's handoff artifacts and the original plan. Does not modify the worktree, registry, or any files.\n\nSide effects: spawns a short-lived AI agent session (network I/O); no filesystem mutations.",
    examples: ["phax review-compliance usage-cli"],
  },

  "review-code": {
    longHelp:
      "Opens an interactive, pre-prompted code-review session for a review_open run by launching the AI agent in the run's worktree with the code-review prompt. The session is resumable: re-running resumes the existing session, while --new-session starts fresh. The developer takes over the session to investigate, discuss, and apply fixes.\n\nSide effects: writes a code-review prompt file under the worktree's .phax-context/ and a session record under the run directory; spawns a long-lived interactive AI agent session (network I/O).",
    examples: ["phax review-code usage-cli"],
  },

  "plans-overlap": {
    longHelp:
      "Two modes:\n\n(Predicted) Without --landed: reads each plan.md's structured form through the content-addressed extraction cache (a cold cache miss extracts once via LLM and caches the result; use --no-extract to fail on a miss instead). Unions each plan's declared phase file-sets into a per-plan footprint, intersects footprints pairwise, and reports the severity-graded conflict matrix, clean pairs, the largest fully-disjoint parallel-safe set, and a greedy wave schedule.\n\n(Confirmed) With --landed <run>: takes a run that has already produced changes and reports which of the given plans need re-adjustment because they touch a file the run actually changed. The landed run's footprint is read from its persisted global-file-reconciliation.json (the real git diff across its phases), giving actual-vs-declared impact with no false negatives.\n\nCaveats: the predicted mode reflects declared file intentions, not what agents will actually touch. Conflicts are file-level, not hunk-level — two plans editing different regions of the same file are flagged even if git would auto-merge them. Regenerated artifacts (phax.usage.kdl, docs/cli/reference.md) are a hard-conflict class.\n\nSide effects: read-only with respect to your plans; may run one LLM extraction per uncached plan.md.",
    examples: [
      "phax plans-overlap docs/plans/33-a.md docs/plans/35-b.md",
      "phax plans-overlap --landed my-feature docs/plans/40-other.md",
    ],
  },
};
