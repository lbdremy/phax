// The docs site's structure: every README `##` section and every docs source
// is assigned here exactly once — rendered on a route, or omitted with a
// reason. `pnpm site:build` fails naming any section or file this map misses
// or names in vain.
import { INTRO, definePageMap } from "./build/pageMap.js";

export default definePageMap({
  repository: "https://github.com/lbdremy/phax",
  readme: [
    { route: "/", title: "phax", sections: [INTRO, "Quickstart"] },
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
