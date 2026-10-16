// The docs site's structure: every README `##` section and every docs source
// is assigned here exactly once — rendered on a route, or omitted with a
// reason. `pnpm site:build` fails naming any section or file this map misses
// or names in vain.
import { INTRO, definePageMap } from "./build/pageMap.js";

export default definePageMap({
  repository: "https://github.com/lbdremy/phax",
  readme: [
    {
      route: "/",
      title: "phax",
      sections: [INTRO, "Quickstart"],
      home: {
        name: "phax",
        text: "The golden path, just facts.",
        tagline:
          "phax runs your plan through AI coding agents one gated phase at a time, and hands you a change already checked against the plan.",
        actions: [
          { text: "Get started", link: "/guide/install", theme: "brand" },
          { text: "How phax works", link: "/guide/concepts", theme: "alt" },
        ],
        install: "npm install -g @lbdremy/phax",
        features: [
          {
            key: "gates",
            title: "Nothing moves on red",
            details:
              "Every phase must pass your project's gates (typecheck, tests, lint…) before the next one starts. A failure goes back to the same agent session to fix.",
            link: "/guide/set-up",
          },
          {
            key: "worktrees",
            title: "One worktree per phase",
            details:
              "Each phase runs in its own Git worktree, on a branch made from the previous phase. The last one stays open for your review.",
            link: "/guide/run",
          },
          {
            key: "footprint",
            title: "Planned vs. done",
            details:
              "Each phase declares the files it will create and edit. phax compares them with what it actually changed, and the agent justifies every gap in its handoff.",
            link: "/guide/concepts",
          },
          {
            key: "agents",
            title: "Your agent",
            details:
              "Claude Code, OpenAI Codex or Mistral Vibe, with the model and effort chosen per phase.",
            link: "/guide/providers-and-security",
          },
          {
            key: "compliance",
            title: "Checked against the plan",
            details:
              "When the run reaches review, an agent checks the work against the plan, phase by phase, and writes a verdict. It changes nothing.",
            link: "/guide/review-and-land",
          },
          {
            key: "pull request",
            title: "A PR that explains itself",
            details:
              "<code>phax publish-pr</code> opens the pull request with the compliance verdict, one line per phase and what still needs your review.",
            link: "/guide/review-and-land",
          },
          {
            key: "records",
            title: "History that outlives the worktrees",
            details:
              "With records on, every phase leaves a commit on <code>phax/records/v1</code>: manifest, gate results, reconciliation, diff, handoff and, if you keep it, the transcript.",
            link: "/guide/records",
          },
          {
            key: "deterministic",
            title: "Only the agent guesses",
            details:
              "Sequencing, gates, retries and state are plain code. The agent is the only non-deterministic part.",
            link: "/guide/concepts",
          },
          {
            key: "lifecycle",
            title: "Specs and plans with a status",
            details:
              "Draft, Approved, Stale, Completed. Every transition is committed, and an approval records what it was made against.",
            link: "/guide/specs-and-plans",
          },
        ],
      },
    },
    {
      route: "/guide/install",
      title: "Installation",
      sections: ["Install"],
      description:
        "Install the phax CLI with npm (@lbdremy/phax), a launcher that fetches and caches the binary for your platform, and set up shell completions.",
    },
    {
      route: "/guide/concepts",
      title: "How phax works",
      sections: ["Concepts"],
      description:
        "Specs and plans and their lifecycle, runs and phases in Git worktrees, gates, handoffs, reconciliation, review, records and where phax keeps its state.",
    },
    {
      route: "/guide/set-up",
      title: "Project setup",
      sections: ["Set up a project"],
      description:
        "Set up a repository for phax: phax init writes phax.json with your project's name, its gate commands, and whether runs are reviewed and published.",
    },
    {
      route: "/guide/specs-and-plans",
      title: "Writing specs and plans",
      sections: ["Specs and plans"],
      description:
        "Write a spec and a plan with your agent or headless from a brief, lint and approve them, and follow their status from Draft to Completed.",
    },
    {
      route: "/guide/run",
      title: "Running a plan",
      sections: ["Run a plan"],
      description:
        "Run an approved plan with phax run: each phase in its own Git worktree, held by your gates, fixed by the same agent session when a gate fails.",
    },
    {
      route: "/guide/review-and-land",
      title: "Reviewing and landing",
      sections: ["Review and land"],
      description:
        "Review a finished run: its review handoff, the compliance review against the plan, phax review-code, then publish-pr opens the pull request.",
    },
    {
      route: "/guide/records",
      title: "Run records",
      sections: ["Records"],
      description:
        "Records keep a run's history: one commit per phase on phax/records/v1, with its manifest, gate results, file reconciliation, diff and handoff.",
    },
    {
      route: "/guide/providers-and-security",
      title: "Agents and security",
      sections: ["Providers and security"],
      description:
        "Run phases with Claude Code, OpenAI Codex or Mistral Vibe: how phax routes a model to a provider, and the security modes that sandbox each agent.",
    },
    {
      route: "/guide/extend",
      title: "Extending phax",
      sections: ["Extend phax"],
      description:
        "Plug your own tools into a run: gate steps that return findings, a brief provider that answers each phase, and a plan auditor.",
    },
    {
      route: "/reference/formats",
      title: "File formats",
      sections: ["Persisted formats", "Read phax files from code"],
      generated: "served-schemas",
      description:
        "The files phax writes, each named by its $schema URL on docs.phax.run, and @lbdremy/phax-schemas to read them from your own code.",
    },
    {
      route: "/reference/exit-codes",
      title: "Exit codes and environment",
      sections: ["Exit codes", "Environment"],
      description:
        "What each phax exit code means, the subset phax prune uses, and why phax reads its configuration from files rather than environment variables.",
    },
    {
      route: "/guide/troubleshooting",
      title: "When something goes wrong",
      sections: ["Troubleshooting"],
      description:
        "Fix a run that went wrong: a gate that keeps failing, a phase to start over, and phax report to open an issue with the run's telemetry.",
    },
    {
      omit: ["CLI command reference"],
      why: "generated summary; /reference/cli is the full reference",
    },
  ],
  files: [
    {
      route: "/reference/cli",
      title: "CLI reference",
      source: "docs/cli/reference.md",
      description:
        "Every phax command with its flags and arguments: artifacts, plans, runs, review and publishing, records, and the read-only commands.",
    },
    {
      route: "/guide/arbitration",
      title: "Deciding open questions",
      source: "docs/arbitration.md",
      description:
        "Decide open questions with phax artifact decide: framing first, then each question under a doctrine, and the body diff accepted before writing.",
    },
    {
      route: "/reference/model-catalog",
      title: "Model catalog",
      source: "docs/model-catalog.md",
      description:
        "The models phax routes to on Claude Code, OpenAI Codex and Mistral Vibe, their effort levels, and the default model behind each of phax's own jobs.",
    },
    {
      route: "/security",
      title: "Security",
      source: "docs/security.md",
      description:
        "How phax keeps coding agents safe by default: provider-native sandboxes, its three security modes, their configuration and how to verify them.",
    },
    {
      route: "/contributing",
      title: "Contributing",
      source: "CONTRIBUTING.md",
      description:
        "Work on phax itself: the checks and test tiers, the state machine, telemetry, the CLI contract, the binary and how releases are cut.",
    },
    {
      route: "/contributing/release",
      title: "Releasing",
      source: "docs/release.md",
      description:
        "Cut a phax release: SSH signing, the trusted publisher, cutting and tagging, the release workflow, staged npm packages and the docs site deploy.",
    },
    {
      route: "/compare/openspec-vs-phax",
      title: "OpenSpec vs. phax",
      source: "docs/comparisons/openspec-vs-phax.md",
      description:
        "OpenSpec vs. phax, side by side: OpenSpec structures the spec conversation; phax runs the approved plan through coding agents in gated phases.",
    },
    {
      route: "/compare/spec-kit-vs-phax",
      title: "Spec Kit vs. phax",
      source: "docs/comparisons/spec-kit-vs-phax.md",
      description:
        "Spec Kit vs. phax, side by side: a methodology and prompt layer that runs your agent step by step, against a harness of gated, reviewable phases.",
    },
    {
      route: "/blog/announcing-phax-1-0",
      title: "Announcing phax 1.0",
      source: "docs/blog/announcing-phax-1.0.md",
      holdUntil: "1.0.0",
      description:
        "phax 1.0 is out: why it was built, and what running a coding agent through isolated, reviewable phases changes for you.",
    },
  ],
});
