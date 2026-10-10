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

/** Two steps of one gate profile that run the same command. */
export interface DuplicateCommand {
  /** The first occurrence's words, joined by single spaces (`pnpm test`). */
  readonly command: string;
  /** 1-based position of the first step. */
  readonly first: number;
  /** 1-based position of the later step with the same command. */
  readonly second: number;
}

/**
 * The first pair of steps whose commands are the same (`sameCommand`), with
 * 1-based positions, or undefined when every command is distinct.
 */
export function findDuplicateCommand(
  steps: readonly { readonly command: string }[],
): DuplicateCommand | undefined {
  for (let second = 1; second < steps.length; second++) {
    for (let first = 0; first < second; first++) {
      if (sameCommand(steps[first]!.command, steps[second]!.command)) {
        return {
          command: commandWords(steps[first]!.command).join(" "),
          first: first + 1,
          second: second + 1,
        };
      }
    }
  }
  return undefined;
}
