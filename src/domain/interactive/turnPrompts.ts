// The prompts of phax's own turns at a declared stop: the read-only first
// turn, the one corrective resume after an invalid answer, the read-only
// closing turn, and the first message of a fresh session. Every turn prompt
// tells the session to change nothing and to answer one document. Pure.

/** The most of the corrections' diff a closing prompt embeds, in bytes. */
export const CLOSING_DIFF_LIMIT_BYTES = 200_000;

export interface ClosingDiff {
  readonly text: string;
  /** True when `text` is the first `CLOSING_DIFF_LIMIT_BYTES` of a longer diff. */
  readonly truncated: boolean;
  /** Every changed path, whether or not its hunk is in `text`. */
  readonly paths: readonly string[];
}

/**
 * The diff as a closing prompt embeds it: whole when it fits the limit, else
 * its first `CLOSING_DIFF_LIMIT_BYTES` bytes (cut on a character boundary),
 * marked as cut. `paths` always lists every changed path.
 */
export function cutDiff(text: string, paths: readonly string[]): ClosingDiff {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= CLOSING_DIFF_LIMIT_BYTES) return { text, truncated: false, paths };
  let end = CLOSING_DIFF_LIMIT_BYTES;
  // Step back off a UTF-8 continuation byte so the cut keeps whole characters.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), truncated: true, paths };
}

// A fence longer than any run of backticks in the text it wraps.
function fenceFor(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

function answerRules(documentName: string): string[] {
  return [
    "Change nothing: this turn is read-only. Edit no file, create none and delete none.",
    `Answer only with ${/^[aeiou]/.test(documentName) ? "an" : "a"} ${documentName} document: one JSON object valid against the JSON Schema below, with no code fence and no commentary.`,
  ];
}

function schemaBlock(documentName: string, schemaJson: string): string[] {
  const fence = fenceFor(schemaJson);
  return ["", `## ${documentName} JSON Schema`, "", `${fence}json`, schemaJson, fence, ""];
}

/** The first turn: read the seed, answer a `first-reading` document. */
export function firstTurnPrompt(input: {
  readonly seedPath: string;
  readonly schemaJson: string;
}): string {
  return [
    `Read ${input.seedPath}. It describes a phase of a plan that a person is about to review, and the phases that follow it.`,
    "",
    "Report the pattern the phase introduces, what each upcoming phase copies from it, and what the person should check first.",
    "",
    ...answerRules("first-reading"),
    ...schemaBlock("first-reading", input.schemaJson),
  ].join("\n");
}

/**
 * The one corrective resume after an answer that was not valid: it names the
 * defect and asks for the whole document again. It repeats neither the seed
 * nor the schema, which the resumed session already holds.
 */
export function correctivePrompt(defect: string): string {
  return [
    "Your final message was refused, and phax kept nothing from it.",
    "",
    `Refusal: ${defect}`,
    "",
    "Change nothing. Answer again with the whole document: one JSON object valid against the JSON Schema you were given, with no code fence and no commentary. This is your only retry.",
    "",
  ].join("\n");
}

/**
 * The closing turn: given the corrections as a diff, answer an
 * `interactive-handoff` document. `seedPath` is null on a resumed session,
 * which already holds the seed, and set on a new one.
 */
export function closingTurnPrompt(input: {
  readonly diff: ClosingDiff;
  readonly seedPath: string | null;
  readonly schemaJson: string;
}): string {
  const { diff } = input;
  const diffFence = fenceFor(diff.text);
  return [
    input.seedPath === null
      ? "The person who reviewed this phase has finished. Here is what they changed in the worktree."
      : `The person who reviewed this phase has finished. Read ${input.seedPath} for the phase and the plan around it, then read what they changed in the worktree.`,
    "",
    "## Corrections",
    "",
    ...(diff.truncated
      ? [
          `The diff is cut after ${CLOSING_DIFF_LIMIT_BYTES} bytes. These are all the changed paths; read the ones whose hunks are missing in the worktree:`,
          ...diff.paths.map((path) => `- ${path}`),
          "",
        ]
      : []),
    `${diffFence}diff`,
    diff.text.trimEnd(),
    diffFence,
    ...(diff.truncated ? ["", "(diff cut)"] : []),
    "",
    "Describe what was corrected, the pattern to follow from now on, and for each correction what guards it: a test, a lint rule or a gate step, or why nothing does. Give exactly one guard per correction, in the same order.",
    "",
    ...answerRules("interactive-handoff"),
    ...schemaBlock("interactive-handoff", input.schemaJson),
  ].join("\n");
}

/** The first message of a session the person starts by hand at the stop. */
export function freshStartPrompt(phaseId: string): string {
  return `Read .phax-context/interactive-review.md, then review ${phaseId} with me.`;
}
