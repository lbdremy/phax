import type { DefinedGateProfile } from "../../src/domain/gate/gateProfile.js";

/** Two defined profiles, and the section a planning prompt holds for them. */
export const GATE_PROFILES: readonly DefinedGateProfile[] = [
  {
    id: "standard",
    steps: [
      { command: "pnpm typecheck", surface: "local", firing: "every-phase", output: "log" },
      { command: "pnpm test", surface: "local", firing: "terminal", output: "log" },
    ],
  },
  {
    id: "light",
    steps: [{ command: "pnpm lint", surface: "local", firing: "every-phase", output: "log" }],
  },
];

export const GATE_PROFILE_SECTION = [
  "## Gate profiles defined in phax.json",
  "",
  "Declare exactly one of them as `run.gateProfile`; phax renders it as the plan's `## Gate profile` section.",
  "",
  "standard",
  "  every-phase  pnpm typecheck",
  "  terminal     pnpm test",
  "light",
  "  every-phase  pnpm lint",
].join("\n");
