import type { ArchitectureRequest } from "../../schemas/architecture.js";

/**
 * The architecture request: `files` is null for the whole repository,
 * otherwise the working-tree-root-relative paths asked about.
 */
export function architectureRequest(
  files: readonly [string, ...string[]] | null,
): ArchitectureRequest {
  return { files };
}

/**
 * What `phax architecture` prints on stdout, as one line meant for the agent,
 * when no architecture provider is configured. The exit is still 1, but this
 * is no failure of the repository: the agent reads the code instead.
 */
export const NO_ARCHITECTURE_PROVIDER =
  'No architecture provider is configured ("architecture" in phax.json): read the architecture from the code and its documentation (README, CLAUDE.md or equivalent) instead and carry on — this is not a failure of the repository.';
