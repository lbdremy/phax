/**
 * The words of a gate step's command, split the way phax runs it: on runs of
 * whitespace, with leading and trailing whitespace ignored (`pnpm  test` →
 * `["pnpm", "test"]`).
 */
export function commandWords(raw: string): readonly string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

/** Whether two gate commands split into the same words, so phax runs them alike. */
export function sameCommand(a: string, b: string): boolean {
  const left = commandWords(a);
  const right = commandWords(b);
  return left.length === right.length && left.every((word, index) => word === right[index]);
}
