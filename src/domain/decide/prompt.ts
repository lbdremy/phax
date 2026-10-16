import { getHandDecisionAnswerFileJsonSchema } from "../../schemas/handDecisionAnswer.js";
import { getPlanDocumentFileJsonSchema } from "../../schemas/planDocument.js";
import type { OpenQuestion } from "../../schemas/questions.js";
import { getSpecDocumentFileJsonSchema } from "../../schemas/specDocument.js";
import { type SidecarDocument, serializeSidecar } from "../artifact/sidecar.js";
import type { ArtifactKind } from "../artifact/status.js";
import type { Doctrine } from "./doctrine.js";
import { type DecideQuestions, type DecideScope, questionsOf } from "./revision.js";

// The texts of a decide session: the interactive prompt the operator's session
// starts from, the handback that resumes it headless for the revised document,
// and the one corrective resume. Pure: the same input yields the same text, so
// the recorded prompt reproduces the session's input exactly.

/** The framing questions a decide session raises before any open question (spec §4). */
export const FRAMING_QUESTIONS: ReadonlyArray<{ readonly id: string; readonly question: string }> =
  [
    { id: "F1", question: "who consumes this, and what exactly does it read?" },
    { id: "F2", question: "what persists, and how is it read in a year?" },
    { id: "F3", question: "how is a thing identified without its location?" },
    { id: "F4", question: "what can be removed?" },
    { id: "F5", question: "does the cited doctrine still say what the operator intends?" },
  ];

/**
 * How the artifact was authored, and so what the session reads and returns:
 * a headless artifact's sidecar document, revised whole as a document; or a
 * hand-authored artifact's Markdown, answered as a hand decision answer.
 */
type DecideAuthoring =
  | {
      readonly variant: "headless";
      /** The artifact's document, as its sidecar holds it. */
      readonly document: SidecarDocument;
    }
  | {
      readonly variant: "hand";
      /** The artifact's Markdown, frontmatter included. */
      readonly markdown: string;
    };

export interface DecidePromptInput {
  readonly kind: ArtifactKind;
  /** The artifact's repo-relative path. */
  readonly artifactPath: string;
  readonly doctrine: Doctrine;
  readonly scope: DecideScope;
  readonly authoring: DecideAuthoring;
}

function answerJsonSchema(kind: ArtifactKind, variant: DecideAuthoring["variant"]): object {
  if (variant === "hand") return getHandDecisionAnswerFileJsonSchema();
  return kind === "spec" ? getSpecDocumentFileJsonSchema() : getPlanDocumentFileJsonSchema();
}

function arrayPath(kind: ArtifactKind, key: "openQuestions" | "arbitratedQuestions"): string {
  return kind === "spec" ? key : `preamble.${key}`;
}

// The headings of the sections phax writes in a hand-authored artifact.
const HAND_SECTIONS: Readonly<Record<ArtifactKind, string>> = {
  spec: "`## 9. Open questions`, `## 9b. Arbitrated questions` and `## 12. Decision log`",
  plan: "`## Open questions`, `## Arbitrated questions` and `## Decision log`",
};

// A code fence longer than any backtick run in the text, so the text stays
// inside it.
function fenceFor(text: string): string {
  const longest = Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

function renderQuestion(question: OpenQuestion): string[] {
  return [
    `### ${question.id} — ${question.question}`,
    "",
    ...question.options.map((o) => `- ${o.id} — ${o.label} — abandons: ${o.abandons}`),
    "",
    `Recommendation: ${question.recommendation} — ${question.rationale}`,
  ];
}

// A hand-authored artifact's questions are read in its Markdown, by id.
function handPresentedSection(input: DecidePromptInput): string[] {
  return [
    "",
    ...input.scope.presented.map((id) =>
      id === input.scope.reArbitrated
        ? `- ${id} — re-arbitrated: its current Decision block is under \`### ${id} — …\` in the artifact below. A new verdict replaces it; phax keeps the current one as an earlier decision.`
        : `- ${id} — under \`### ${id} — …\` in the artifact below.`,
    ),
  ];
}

function presentedSection(input: DecidePromptInput, questions: DecideQuestions): string[] {
  const lines: string[] = [];
  for (const id of input.scope.presented) {
    const open = questions.openQuestions.find((q) => q.id === id);
    const arbitrated = questions.arbitratedQuestions.find((q) => q.id === id);
    const question = open ?? arbitrated;
    if (question === undefined) continue;
    lines.push("", ...renderQuestion(question));
    if (arbitrated !== undefined) {
      const { verdict } = arbitrated;
      const by = verdict.by.kind === "operator" ? `the operator (${verdict.by.name})` : "no one";
      lines.push(
        "",
        `Current verdict (${verdict.kind}, by ${by}, at ${verdict.at}): ${verdict.chosen} — ${verdict.why}`,
        "",
        "This question is being re-arbitrated: a new verdict replaces this one, which phax keeps in its history.",
      );
    }
  }
  return lines;
}

/**
 * The prompt an interactive decide session starts from, in a fixed order: the
 * role (facilitate; the operator decides; never change the repository); the
 * framing questions `F1`–`F5`; the questions in `scope.presented` order, an
 * arbitrated one with its current verdict; what to gather for each verdict;
 * the body revisions a departing verdict implies; how the session ends; then
 * the doctrine text, the artifact (a headless one's sidecar JSON, a
 * hand-authored one's Markdown) and the JSON Schema of the answer (the
 * document format, or the hand decision answer).
 */
export function buildDecidePrompt(input: DecidePromptInput): string {
  const { kind, artifactPath, doctrine, scope, authoring } = input;
  const ids = scope.presented.join(", ");
  const principleIds = [...doctrine.principleIds];
  const artifactSection =
    authoring.variant === "headless"
      ? [
          `## The ${kind} document (sidecar of \`${artifactPath}\`)`,
          "",
          "```json",
          serializeSidecar(authoring.document).trimEnd(),
          "```",
        ]
      : [
          `## The ${kind} artifact (\`${artifactPath}\`, hand-authored)`,
          "",
          `It has no sidecar: its questions are its ${HAND_SECTIONS[kind]} sections, which phax writes itself.`,
          "",
          `${fenceFor(authoring.markdown)}markdown`,
          authoring.markdown.trimEnd(),
          fenceFor(authoring.markdown),
        ];
  const schemaTitle =
    authoring.variant === "headless"
      ? `## Revised ${kind} document JSON Schema`
      : "## Hand decision answer JSON Schema";
  const sections: string[] = [
    `# phax artifact decide — ${kind} \`${artifactPath}\``,
    "",
    "You facilitate this session, and the operator decides. Propose, argue and ask; never decide in the operator's place.",
    "",
    "Never write a file, and never run a command that changes the repository. phax writes and commits the artifact itself, once the operator accepts the body diff.",
    "",
    "## 1. Framing first",
    "",
    "Before any question, raise these framing questions with the operator, one at a time, and let the operator correct the framing. Carry every correction into the questions that follow.",
    "",
    ...FRAMING_QUESTIONS.map((f) => `- ${f.id}: ${f.question}`),
    "",
    "## 2. The questions",
    "",
    `Then present each question below, in this order: ${ids}. Give its options, what each abandons, and the recommendation; argue the strongest case for an abandoned option before the operator chooses. A question the operator does not decide stays as it is.`,
    ...(authoring.variant === "headless"
      ? presentedSection(input, questionsOf(authoring.document))
      : handPresentedSection(input)),
    "",
    "## 3. Each verdict",
    "",
    "For each verdict the operator gives, gather:",
    "",
    "- chosen: the id of the option chosen;",
    "- why: the reason, in the operator's terms;",
    "- advocate: the strongest case for an abandoned option;",
    `- principles: the doctrine principle ids the verdict rests on, only ids the doctrine below defines (${principleIds.length === 0 ? "none" : principleIds.join(", ")});`,
    "- reversibility: cheap, costly or irreversible — the cost of undoing the verdict;",
    ...(kind === "plan" ? ["- phase: the id of the plan phase the verdict bears on;"] : []),
    "- revised: the body sections the verdict changed, or none.",
    "",
    "## 4. Departures revise the body",
    "",
    `When a verdict departs from the recommendation, propose the body revisions it implies (requirements, surface, acceptance criteria, planning note), agree them with the operator, and name each revised section in \`revised\`. A verdict that follows the recommendation changes no other part of the document unless the operator asks.`,
    "",
    "## 5. Ending the session",
    "",
    "When the operator is done, tell them to exit the session. phax then resumes it and asks for the revised document; do not return it before.",
    "",
    "## Doctrine",
    "",
    doctrine.text.trimEnd(),
    "",
    ...artifactSection,
    "",
    schemaTitle,
    "",
    "```json",
    JSON.stringify(answerJsonSchema(kind, authoring.variant), null, 2),
    "```",
    "",
  ];
  return sections.join("\n");
}

export interface HandbackPromptInput {
  readonly kind: ArtifactKind;
  /**
   * How the artifact was authored: `headless` returns the revised document,
   * `hand` a hand decision answer.
   */
  readonly variant: DecideAuthoring["variant"];
  /**
   * The `$schema` URL the answer carries, at its format's current stamp: the
   * document format for `headless`, `hand-decision-answer` for `hand`.
   */
  readonly schemaUrl: string;
}

/**
 * The prompt that resumes the session headless once the operator has exited.
 * For a headless artifact: the whole revised document as the final message
 * alone, in its sidecar form, `$schema` first, decided questions moved to
 * the arbitrated array. For a hand-authored one: a hand decision answer, the
 * decided verdicts and the whole revised Markdown, with the frontmatter, the
 * question sections and the decision log left exactly as they were, since
 * phax writes those.
 */
export function buildHandbackPrompt(input: HandbackPromptInput): string {
  const { kind, schemaUrl } = input;
  if (input.variant === "hand") {
    return [
      "The operator has ended the decide session.",
      "",
      `Return now, as your final message alone, one JSON object valid against the hand decision answer JSON Schema you were given, with \`$schema\` first, set to \`${schemaUrl}\`. No code fence, no Markdown, no commentary before or after the JSON.`,
      "",
      `- \`kind\`: \`${kind}\`.`,
      `- \`decisions\`: one \`{ id, verdict }\` per question the operator decided in this session, with a \`decided\` verdict${kind === "plan" ? " naming its `phase`" : ""}; \`[]\` when nothing was decided.`,
      `- \`markdown\`: the artifact's whole revised Markdown. Leave its frontmatter, its ${HAND_SECTIONS[kind]} sections exactly as they were: phax moves each decided question, writes its Decision block and appends to the decision log itself.`,
      "- Revise the body only as the verdicts imply, and name the revised sections in each verdict's `revised`.",
      "- phax sets each verdict's `by` and `at`.",
      "- When nothing was decided, return the Markdown unchanged.",
      "",
    ].join("\n");
  }
  return [
    "The operator has ended the decide session.",
    "",
    `Return now, as your final message alone, the artifact's whole revised ${kind} document in its sidecar form: one JSON object valid against the revised ${kind} document JSON Schema you were given, with \`$schema\` first, set to \`${schemaUrl}\`. No code fence, no Markdown, no commentary before or after the JSON.`,
    "",
    `- Move each question the operator decided in this session from \`${arrayPath(kind, "openQuestions")}\` to \`${arrayPath(kind, "arbitratedQuestions")}\`, keeping every field it had, with a \`decided\` verdict and \`history: []\`.`,
    "- A re-arbitrated question keeps its place; its new verdict replaces the current one, which moves to the end of its `history`.",
    "- Revise the body as the verdicts imply, and name the revised sections in each verdict's `revised`.",
    "- phax sets each verdict's `by` and `at`.",
    "- Leave every other question exactly as it was.",
    "- When nothing was decided, return the document unchanged.",
    "",
  ].join("\n");
}

/**
 * The prompt of the single corrective resume: the refusal, and the answer
 * asked for again — the whole revised document for a headless artifact, a
 * hand decision answer for a hand-authored one. It repeats neither the schema
 * nor the document, which the resumed session already holds.
 */
export function buildDecideRetryPrompt(
  variant: DecideAuthoring["variant"],
  refusal: string,
): string {
  const head =
    variant === "hand"
      ? "Your hand decision answer was refused, and phax wrote nothing."
      : "Your revised document was refused, and phax wrote nothing.";
  const ask =
    variant === "hand"
      ? "Return the whole hand decision answer again as your final message — its `kind`, its `decisions` and the artifact's whole revised `markdown`: one JSON object valid against the schema you were given, `$schema` first, with no code fence and no commentary. This is your only retry."
      : "Return the whole revised document again as your final message: one JSON object valid against the schema you were given, `$schema` first, with no code fence and no commentary. This is your only retry.";
  return [head, "", `Refusal: ${refusal}`, "", ask, ""].join("\n");
}

/** The short first message of the interactive session, pointing it at the prompt file. */
export function positionalPrompt(promptRelPath: string): string {
  return `Read ${promptRelPath} and follow it.`;
}
