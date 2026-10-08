import type { BriefAnswer, BriefGuarantee, BriefPlace } from "../../schemas/brief.js";

/** The most guarantees the pushed brief shows; `phax brief` prints the rest. */
export const BRIEF_PUSH_CAP = 50;

const HEADING = "## Brief for this phase";

const INTRO =
  "What the project's standard expects of the files this phase plans, and how each expectation stands, in the provider's order. It informs; the gate decides.";

// The three instructions every variant of the section ends with (spec §5.32).
const INSTRUCTIONS = [
  "Before touching any file, planned or not, existing or not yet created, run `phax brief <path> [<path>…]` to see the guarantees over it, their state there, what is wrong and how to repair it.",
  "`phax brief` with no path prints this phase's brief whole, as the code stands now.",
  "To learn where the phase stands, run the gate commands listed under Execution rules. The brief never fails the phase.",
];

function locationText(place: BriefPlace): string {
  const { file, line } = place.location;
  return line === undefined ? file : `${file}:${line}`;
}

function dueText(place: BriefPlace): string {
  if (place.state === "met" || place.state === "accepted" || place.due === null) return "";
  return place.due === "this-phase" ? " (this phase)" : " (later)";
}

/**
 * One guarantee in compact form: id, statement, then each non-met place's
 * state, location and due, in the provider's order. Never `what` or `repair`.
 */
function compactLine(guarantee: BriefGuarantee): string {
  const open = guarantee.places.filter((place) => place.state !== "met");
  const tail =
    open.length === 0
      ? " · met"
      : open.map((place) => ` · ${place.state} ${locationText(place)}${dueText(place)}`).join("");
  return `- ${guarantee.id} — ${guarantee.statement}${tail}`;
}

function answeredBody(answer: BriefAnswer): readonly string[] {
  const { guarantees } = answer;
  if (guarantees.length === 0) {
    return ["The brief provider has nothing to report on this phase's planned files."];
  }
  const shown = guarantees.slice(0, BRIEF_PUSH_CAP).map(compactLine);
  const hidden = guarantees.length - shown.length;
  return hidden > 0
    ? [...shown, `- …and ${hidden} more not shown. \`phax brief\` prints the phase's brief whole.`]
    : shown;
}

/**
 * The `## Brief for this phase` section of a phase's first prompt: the pushed
 * brief in compact form, or the line saying it is unavailable and why, then
 * the three instructions. No trailing newline.
 */
export function renderBriefSection(
  input:
    | { readonly kind: "answered"; readonly answer: BriefAnswer }
    | { readonly kind: "failed"; readonly reason: string },
): string {
  const body =
    input.kind === "answered"
      ? answeredBody(input.answer)
      : [
          `The brief is unavailable at phase start (${input.reason}). \`phax brief\` may still answer.`,
        ];
  return [HEADING, "", INTRO, "", ...body, "", ...INSTRUCTIONS].join("\n");
}

// The widest state, `forbidden`, sets the column the locations start at.
const STATE_WIDTH = "forbidden".length;

function wholePlaceLines(place: BriefPlace): readonly string[] {
  const due =
    place.state === "met" || place.state === "accepted" || place.due === null
      ? ""
      : place.due === "this-phase"
        ? "   due this phase"
        : "   due later";
  const lines = [`  ${place.state.padEnd(STATE_WIDTH)}  ${locationText(place)}${due}`];
  if (place.state !== "met") lines.push(`    what:    ${place.what}`);
  if (place.state === "missing" || place.state === "forbidden") {
    lines.push(`    repair:  ${place.repair}`);
  }
  return lines;
}

/**
 * A brief in whole form, as `phax brief` prints it: every guarantee and every
 * place in the provider's order, with state, location, due, what and repair
 * wherever the state has them. No trailing newline.
 */
export function renderWholeBrief(answer: BriefAnswer): string {
  return answer.guarantees
    .flatMap((guarantee) => [
      `${guarantee.id} — ${guarantee.statement}`,
      ...guarantee.places.flatMap(wholePlaceLines),
    ])
    .join("\n");
}

/** What `phax brief` prints for an empty answer; `null` is the phase's brief. */
export function renderNoBrief(files: readonly string[] | null): string {
  return files === null
    ? "No brief for this phase's planned files."
    : `No brief for ${files.join(", ")}.`;
}
