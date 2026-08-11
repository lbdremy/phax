export function isPortcelainClean(output: string): boolean {
  return output.trim() === "";
}

export function parseBranchOutput(output: string): string {
  return output.trim();
}

export function parseBranchExistsOutput(output: string): boolean {
  return output.trim().length > 0;
}

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

export function parseHeadCommitOutput(output: string): string | null {
  const trimmed = output.trim();
  return FULL_SHA_PATTERN.test(trimmed) ? trimmed : null;
}

export function parseChangedFilesOutput(output: string): readonly string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// `git status --porcelain` lines are "XY PATH" (untracked: "?? PATH"), or for
// renames "R  OLD -> NEW" — both the old and new side count as dirty.
export function parseDirtyPaths(output: string): readonly string[] {
  const paths: string[] = [];
  for (const line of output.split("\n")) {
    if (line.length === 0) continue;
    const rest = line.slice(3);
    const arrowIndex = rest.indexOf(" -> ");
    if (arrowIndex === -1) {
      paths.push(rest);
    } else {
      paths.push(rest.slice(0, arrowIndex), rest.slice(arrowIndex + 4));
    }
  }
  return paths;
}
