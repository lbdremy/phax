import { getHandDecisionAnswerFileJsonSchema } from "../../schemas/handDecisionAnswer.js";
import { getPlanDocumentFileJsonSchema } from "../../schemas/planDocument.js";
import { OTHER_OPTION_ID, type OpenQuestion } from "../../schemas/questions.js";
import { getSpecDocumentFileJsonSchema } from "../../schemas/specDocument.js";
import { type SidecarDocument, serializeSidecar } from "../artifact/sidecar.js";
import type { ArtifactKind } from "../artifact/status.js";
import type { Doctrine } from "./doctrine.js";
import { type DecideQuestions, questionsOf } from "./revision.js";
import type { BoundVerdict, BoundVerdicts } from "./verdicts.js";

// The text of a verdicts-mode writer session: one headless turn that
// transcribes decisions a person already made. Pure, so the recorded prompt
// reproduces the session's input exactly. The corrective resume is
// `buildDecideRetryPrompt`, shared with interactive decide.

/**
 * How the artifact was authored, and so what the writer reads and returns: a
 * headless artifact's sidecar document, answered as the whole revised
 * document; or a hand-authored artifact's Markdown, answered as a hand
 * decision answer.
 */
type VerdictsAuthoring =
  | { readonly variant: "headless"; readonly document: SidecarDocument }
  | { readonly variant: "hand"; readonly markdown: string };

export interface VerdictsPromptInput {
  readonly kind: ArtifactKind;
  /** The artifact's repo-relative path. */
  readonly artifactPath: string;
  readonly doctrine: Doctrine;
  /** The verdicts, in document order, and the open questions the file leaves out. */
  readonly bound: BoundVerdicts;
  readonly authoring: VerdictsAuthoring;
  /** The `$schema` URL the answer carries, at its format's current stamp. */
  readonly schemaUrl: string;
}

function answerJsonSchema(kind: ArtifactKind, variant: VerdictsAuthoring["variant"]): object {
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

function renderChoice(verdict: BoundVerdict): string[] {
  const how = !verdict.departs
    ? "it follows the recommendation"
    : verdict.chosen === OTHER_OPTION_ID
      ? "a choice off the menu: it departs from the recommendation, and the note describes it"
      : "it departs from the recommendation";
  return [
    `Recommendation: ${verdict.recommendation}`,
    `Chosen: ${verdict.chosen} — ${how}`,
    verdict.note === null
      ? "Note: none — phax sets this verdict's `why` to the question's rationale."
      : `Note: ${verdict.note}`,
  ];
}

function renderHeadlessVerdict(verdict: BoundVerdict, questions: DecideQuestions): string[] {
  const open = questions.openQuestions.find((q) => q.id === verdict.question);
  const arbitrated = questions.arbitratedQuestions.find((q) => q.id === verdict.question);
  const question: OpenQuestion | undefined = open ?? arbitrated;
  const lines: string[] = ["", `### ${verdict.question} — ${question?.question ?? ""}`, ""];
  for (const option of question?.options ?? []) {
    lines.push(`- ${option.id} — ${option.label} — abandons: ${option.abandons}`);
  }
  lines.push("", `Rationale: ${question?.rationale ?? ""}`, "", ...renderChoice(verdict));
  if (arbitrated !== undefined) {
    const current = arbitrated.verdict;
    const by = current.by.kind === "operator" ? `the operator (${current.by.name})` : "no one";
    lines.push(
      "",
      `Current verdict (${current.kind}, by ${by}, at ${current.at}): ${current.chosen} — ${current.why}`,
      "",
      "This question is being re-arbitrated: the new verdict replaces this one, which phax keeps in its history.",
    );
  }
  return lines;
}

function renderHandVerdict(verdict: BoundVerdict): string[] {
  return [
    "",
    `### ${verdict.question}`,
    "",
    `Its options, what each abandons and its rationale are under \`### ${verdict.question} — …\` in the artifact below.`,
    "",
    ...renderChoice(verdict),
    ...(verdict.state === "arbitrated"
      ? [
          "",
          `This question is being re-arbitrated: its current Decision block is under \`### ${verdict.question} — …\`. The new verdict replaces it; phax keeps the current one as an earlier decision.`,
        ]
      : []),
  ];
}

/**
 * The prompt a verdicts-mode writer session starts from, in a fixed order:
 * the role (transcribe verdicts a person has made; decide nothing, write no
 * file, run no command that changes the repository); the given verdicts in
 * document order, each with its options, its recommendation and rationale,
 * the option chosen, whether it follows or departs, and the note; what to
 * write for each; the body revisions a departing verdict implies; the
 * questions left as they were; what phax sets itself; the final-message
 * contract; then the doctrine text, the artifact and the JSON Schema of the
 * answer. It has no framing questions.
 */
export function buildVerdictsPrompt(input: VerdictsPromptInput): string {
  const { kind, artifactPath, doctrine, bound, authoring, schemaUrl } = input;
  const ids = bound.verdicts.map((v) => v.question);
  const principleIds = [...doctrine.principleIds];
  const hand = authoring.variant === "hand";
  const questions = authoring.variant === "headless" ? questionsOf(authoring.document) : null;

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
  const schemaTitle = hand
    ? "## Hand decision answer JSON Schema"
    : `## Revised ${kind} document JSON Schema`;

  const finalMessage = hand
    ? [
        `Your final message is one JSON object valid against the hand decision answer JSON Schema below, with \`$schema\` first, set to \`${schemaUrl}\`. No code fence, no Markdown, no commentary before or after the JSON.`,
        "",
        `- \`kind\`: \`${kind}\`.`,
        `- \`decisions\`: exactly one \`{ id, verdict }\` per verdict above (${ids.join(", ")}), each with a \`decided\` verdict${kind === "plan" ? " naming its `phase`" : ""}.`,
        `- \`markdown\`: the artifact's whole Markdown. Leave its frontmatter and its ${HAND_SECTIONS[kind]} sections exactly as they were: phax moves each decided question, writes its Decision block and appends to the decision log itself. When no verdict departs, return the Markdown unchanged.`,
      ]
    : [
        `Your final message is the artifact's whole ${kind} document in its sidecar form: one JSON object valid against the revised ${kind} document JSON Schema below, with \`$schema\` first, set to \`${schemaUrl}\`. No code fence, no Markdown, no commentary before or after the JSON.`,
        "",
        `- Move each question above that is open from \`${arrayPath(kind, "openQuestions")}\` to the end of \`${arrayPath(kind, "arbitratedQuestions")}\`, keeping every field it had, with a \`decided\` verdict and \`history: []\`.`,
        "- A question above that is already arbitrated keeps its place; its new verdict replaces the current one, which moves to the end of its `history`, even when the new choice equals the old one.",
        "- When no verdict departs, every other field of the document stays exactly as it was.",
      ];

  const sections: string[] = [
    `# phax artifact decide --verdicts — ${kind} \`${artifactPath}\``,
    "",
    "You transcribe verdicts a person has already made. The person decided; you decide nothing, and you never second-guess a choice.",
    "",
    "Never write a file, and never run a command that changes the repository. phax checks your answer against the verdicts, then writes and commits the artifact itself.",
    "",
    "## 1. The verdicts",
    "",
    `The person gave ${String(bound.verdicts.length)} verdict${bound.verdicts.length === 1 ? "" : "s"}, in the artifact's order: ${ids.join(", ")}.`,
    ...bound.verdicts.flatMap((verdict) =>
      questions === null ? renderHandVerdict(verdict) : renderHeadlessVerdict(verdict, questions),
    ),
    "",
    "## 2. Each verdict",
    "",
    "For each verdict above, write:",
    "",
    "- chosen: the option the person chose, exactly;",
    "- abandoned: every other listed option;",
    "- advocate: the strongest case for an abandoned option;",
    `- principles: the doctrine principle ids the verdict rests on, only ids the doctrine below defines (${principleIds.length === 0 ? "none" : principleIds.join(", ")});`,
    "- reversibility: cheap, costly or irreversible — the cost of undoing the verdict;",
    ...(kind === "plan" ? ["- phase: the id of the plan phase the verdict bears on;"] : []),
    "- revised: the body sections the verdict changed — `[]` for a verdict that follows the recommendation.",
    "",
    "## 3. Departures revise the body",
    "",
    `A verdict that departs from the recommendation implies body revisions (requirements, surface, acceptance criteria, planning note), and you make them, keeping traceability, and name each revised section in \`revised\`. For \`${OTHER_OPTION_ID}\`, apply the choice the note describes; never add an option to the question. A verdict that follows the recommendation changes no part of the body and has \`revised: []\`.`,
    "",
    "## 4. Everything else stays",
    "",
    bound.open.length === 0
      ? "Every question not named above stays exactly as it was."
      : `Every question not named above stays exactly as it was; ${bound.open.join(", ")} stay${bound.open.length === 1 ? "s" : ""} open.`,
    "",
    "## 5. What phax sets",
    "",
    "phax sets each verdict's `why`, `by` and `at` itself, overwriting whatever you write there. Write a short `why` anyway if the schema asks for one.",
    "",
    "## 6. Your answer",
    "",
    ...finalMessage,
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
