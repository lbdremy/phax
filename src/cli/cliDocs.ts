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
      "Extracts a plan from plan.md (or --plan-md), creates a run entry in the registry, and executes each phase sequentially in its own Git worktree using the configured AI agent. Each phase runs a gate profile after execution; the final phase worktree stays open for human review.\n\nSide effects: creates worktrees, commits files, writes to ~/.phax/runs/.",
    examples: [
      "phax run",
      "phax run my-feature",
      "phax run --dry-run",
      "phax run my-feature --profile ci",
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
};
