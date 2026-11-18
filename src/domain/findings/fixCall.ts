// How `phax finding fix` reads its call and words its commit (spec finding-ids-and-fates §5.11,
// §5.12). Pure: the command library hands the command its operands without the place of `--`, so
// the ids and the paths are told apart by the form of a finding id.

const FINDING_ID = /^[FC][1-9][0-9]*$/;

/** Whether `word` is spelled like a finding id: `F` or `C`, then a number without a leading zero. */
export function isFindingId(word: string): boolean {
  return FINDING_ID.test(word);
}

/**
 * The operands after the run reference: the leading operands of the finding-id form are the ids,
 * deduplicated in the order given; every operand from the first one not of that form is a path.
 */
export function splitFixOperands(operands: readonly string[]): {
  readonly ids: readonly string[];
  readonly paths: readonly string[];
} {
  const firstPath = operands.findIndex((operand) => !isFindingId(operand));
  const split = firstPath === -1 ? operands.length : firstPath;
  return {
    ids: [...new Set(operands.slice(0, split))],
    paths: operands.slice(split),
  };
}

/** The default subject of a fix commit: `fix(review): F2, F5 of gate-retry`. */
export function defaultFixSubject(ids: readonly string[], shortName: string): string {
  return `fix(review): ${ids.join(", ")} of ${shortName}`;
}

/**
 * The body of a fix commit: the given paragraph and a blank line when there is one, then the
 * trailers, always phax's and last: `Short-Name`, then one `Finding` per id, in order. Never a
 * `Run-Id`: release notes fold the commit into its run by its short name.
 */
export function fixCommitBody(input: {
  readonly shortName: string;
  readonly ids: readonly string[];
  readonly body: string | undefined;
}): string {
  const trailers = [
    `Short-Name: ${input.shortName}`,
    ...input.ids.map((id) => `Finding: ${id}`),
  ].join("\n");
  const paragraph = input.body?.trim() ?? "";
  return paragraph === "" ? trailers : `${paragraph}\n\n${trailers}`;
}
