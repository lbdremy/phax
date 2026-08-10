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
