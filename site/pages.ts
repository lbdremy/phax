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
    { route: "/guide/install", title: "Installation", sections: ["Install"] },
    { route: "/guide/concepts", title: "How phax works", sections: ["Concepts"] },
    { route: "/guide/set-up", title: "Project setup", sections: ["Set up a project"] },
    {
      route: "/guide/specs-and-plans",
      title: "Writing specs and plans",
      sections: ["Specs and plans"],
    },
    { route: "/guide/run", title: "Running a plan", sections: ["Run a plan"] },
    {
      route: "/guide/review-and-land",
      title: "Reviewing and landing",
      sections: ["Review and land"],
    },
    { route: "/guide/records", title: "Run records", sections: ["Records"] },
    {
      route: "/guide/providers-and-security",
      title: "Agents and security",
      sections: ["Providers and security"],
    },
    { route: "/guide/extend", title: "Extending phax", sections: ["Extend phax"] },
    {
      route: "/reference/formats",
      title: "File formats",
      sections: ["Persisted formats", "Read phax files from code"],
      generated: "served-schemas",
    },
    {
      route: "/reference/exit-codes",
      title: "Exit codes and environment",
      sections: ["Exit codes", "Environment"],
    },
    {
      route: "/guide/troubleshooting",
      title: "When something goes wrong",
      sections: ["Troubleshooting"],
    },
    {
      omit: ["CLI command reference"],
      why: "generated summary; /reference/cli is the full reference",
    },
  ],
  files: [
    { route: "/reference/cli", title: "CLI reference", source: "docs/cli/reference.md" },
    { route: "/reference/model-catalog", title: "Model catalog", source: "docs/model-catalog.md" },
    { route: "/security", title: "Security", source: "docs/security.md" },
    { route: "/contributing", title: "Contributing", source: "CONTRIBUTING.md" },
    { route: "/contributing/release", title: "Releasing", source: "docs/release.md" },
    {
      route: "/compare/openspec-vs-phax",
      title: "OpenSpec vs. phax",
      source: "docs/comparisons/openspec-vs-phax.md",
    },
    {
      route: "/compare/spec-kit-vs-phax",
      title: "Spec Kit vs. phax",
      source: "docs/comparisons/spec-kit-vs-phax.md",
    },
    {
      route: "/blog/announcing-phax-1-0",
      title: "Announcing phax 1.0",
      source: "docs/blog/announcing-phax-1.0.md",
      holdUntil: "1.0.0",
    },
  ],
});
