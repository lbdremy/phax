// These files are derived from the CLI definition and collide on merge when two
// plans both regenerate them, even if neither "edits" them by hand.
export const REGENERATED_ARTIFACTS: ReadonlySet<string> = new Set([
  "phax.usage.kdl",
  "docs/cli/reference.md",
]);
