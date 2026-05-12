export function isPortcelainClean(output: string): boolean {
  return output.trim() === "";
}

export function parseBranchOutput(output: string): string {
  return output.trim();
}

export function parseBranchExistsOutput(output: string): boolean {
  return output.trim().length > 0;
}
