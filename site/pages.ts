// The docs site's structure: every README `##` section and every docs source
// is assigned here exactly once — rendered on a route, or omitted with a
// reason. `pnpm site:build` fails naming any section or file this map misses
// or names in vain.
import { INTRO, definePageMap } from "./build/pageMap.js";

export default definePageMap({
  repository: "https://github.com/lbdremy/phax",
  readme: [
    { route: "/", title: "phax", sections: [INTRO, "Quickstart"] },
    {
      route: "/guide/install",
      title: "Installation",
      sections: ["Install", "Runtime permission posture", "Shell completions"],
    },
    {
      route: "/guide/configure",
      title: "Configuration",
      sections: ["Configure", "Configuration layers", "Schema upgrade"],
    },
    {
      route: "/guide/write-a-plan",
      title: "Writing a plan",
      sections: ["Write a plan", "Lint the plan"],
    },
    { route: "/guide/run", title: "Running a plan", sections: ["Run", "Resume", "Locks"] },
    {
      route: "/guide/review-and-publish",
      title: "Review and publish",
      sections: ["Review loop", "Compliance review & publishing"],
    },
    {
      route: "/guide/multiple-plans",
      title: "Multiple plans",
      sections: ["Coordinating multiple plans"],
    },
    {
      route: "/guide/manage-runs",
      title: "Managing runs",
      sections: ["List runs", "Archive and prune"],
    },
    {
      route: "/guide/model-routing",
      title: "Model routing",
      sections: ["Multi-provider model routing"],
    },
    {
      route: "/guide/security-modes",
      title: "Security modes and notes",
      sections: ["Security modes", "Security notes"],
    },
    {
      route: "/guide/troubleshooting",
      title: "Debugging and troubleshooting",
      sections: ["Debugging", "Observability", "Troubleshooting"],
    },
    {
      route: "/reference/formats",
      title: "File formats",
      sections: ["Persisted formats", "Read phax files from code"],
    },
    {
      route: "/reference/exit-codes",
      title: "Exit codes and environment",
      sections: ["Exit codes", "Environment variables"],
    },
    {
      route: "/contributing/testing",
      title: "Testing and internals",
      sections: ["Testing", "State Machine", "CLI specification (phax.usage.kdl)"],
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
