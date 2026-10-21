import type { ArtifactKind } from "../artifact/status.js";

/** The prompt's filename inside an authoring session folder. */
export const AUTHORING_PROMPT_FILENAME = "prompt.md";

export interface AuthoringPromptInput {
  readonly kind: ArtifactKind;
  /** The bundled skill's SKILL.md, verbatim. */
  readonly skillText: string;
  /** The kind's document JSON Schema (`getSpecDocumentJsonSchema` / `getPlanDocumentJsonSchema`). */
  readonly jsonSchema: object;
  readonly brief: string;
  /** A plan's source spec (path and Markdown); null for a spec or a plan without one. */
  readonly sourceSpec: { readonly path: string; readonly markdown: string } | null;
  /** Whether a plan completes its source spec (`--last`/`--not-last`); null for a spec or a plan without one. */
  readonly completesSpec: boolean | null;
  readonly slug: string;
  /** Whether an architecture provider is configured, for a plan; null for a spec. */
  readonly architectureProvider: boolean | null;
  /** Whether the owner declares assignment bounds, for a plan; null for a spec. */
  readonly assignmentBounds: boolean | null;
  /** Whether an oracles provider is configured, for a plan; null for a spec. */
  readonly oraclesProvider: boolean | null;
}

const ORACLES_CONFIGURED_LINE =
  '- An oracles provider is configured ("oracles" in phax config): you may declare an oracle phase and its discharging phase, as the skill\'s oracle-phase section says.';
const ORACLES_ABSENT_LINE =
  "- No oracles provider is configured: declare no oracle phase; every phase's `oracle` is null.";

const ARCHITECTURE_CONFIGURED_LINE =
  "- An architecture provider is configured: before cutting phases and assigning models, run `phax architecture` (or `phax architecture <path>...` for the parts the plan touches) and plan against its answer.";
const ARCHITECTURE_BOUNDS_SENTENCE =
  " It lists the assignment bounds (phax.json `assignments`) after the parts: assign each phase against them.";
const BOUNDS_WITHOUT_PROVIDER_LINE =
  "- Assignment bounds are declared (phax.json `assignments`), and no architecture provider is configured: before cutting phases and assigning models, run `phax architecture`. It exits 1 with its no-provider line, then lists the bounds; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).";
const ARCHITECTURE_ABSENT_LINE =
  "- No architecture provider is configured: do not run `phax architecture`; read the architecture from the code and its documentation (README, CLAUDE.md or equivalent).";

function architectureLine(provider: boolean, bounds: boolean): string {
  if (provider) return ARCHITECTURE_CONFIGURED_LINE + (bounds ? ARCHITECTURE_BOUNDS_SENTENCE : "");
  return bounds ? BOUNDS_WITHOUT_PROVIDER_LINE : ARCHITECTURE_ABSENT_LINE;
}

// The full prompt of a headless authoring session, in a fixed order: the skill
// text verbatim, the output contract, the document JSON Schema, the source spec
// (plan only), then the brief. Pure: the same input yields the same prompt, so
// the recorded prompt.md reproduces the session's input exactly.
export function buildAuthoringPrompt(input: AuthoringPromptInput): string {
  const documentName = `${input.kind} document`;
  const sections: string[] = [
    input.skillText.trimEnd(),
    "",
    "---",
    "",
    "# Headless authoring — output contract",
    "",
    `You are authoring the ${input.kind} \`${input.slug}\` in a headless session spawned by \`phax artifact new ${input.kind} --headless\`.`,
    "",
    ...(input.architectureProvider === null
      ? []
      : [architectureLine(input.architectureProvider, input.assignmentBounds === true)]),
    ...(input.oraclesProvider === null
      ? []
      : [input.oraclesProvider ? ORACLES_CONFIGURED_LINE : ORACLES_ABSENT_LINE]),
    `- Return ONLY a JSON object valid against the ${documentName} JSON Schema below.`,
    "- No code fences, no Markdown, no commentary before or after the JSON.",
    "- Write no files: phax renders the Markdown artifact from your JSON, writes it and commits it.",
    "- The JSON object is your final message.",
    ...(input.sourceSpec !== null
      ? [
          `- Set \`sourceSpec\` to \`${input.sourceSpec.path}\`.`,
          `- Set \`completesSpec\` to \`${String(input.completesSpec)}\`.`,
        ]
      : input.kind === "plan"
        ? [
            "- Set `sourceSpec` to null: this plan has no source spec.",
            "- Set `completesSpec` to null: this plan has no source spec.",
          ]
        : []),
    ...(input.kind === "spec"
      ? [
          "- Set `arbitratedQuestions` to `[]`: an authoring session leaves every question open, in `openQuestions`.",
        ]
      : [
          "- Leave each technical arbitration you cannot settle as an open question in `preamble.openQuestions`, in the same shape as a spec's: `id`, `question`, `options` (each with `id`, `label` and `abandons`), `recommendation` naming one option id, and `rationale`. The operator answers them before the plan is approved.",
          "- Settled arbitrations stay prose in `preamble.technicalArbitrations`.",
          "- Set `preamble.arbitratedQuestions` to `[]`: an authoring session arbitrates no question.",
        ]),
    "",
    `## ${documentName} JSON Schema`,
    "",
    JSON.stringify(input.jsonSchema, null, 2),
  ];

  if (input.sourceSpec !== null) {
    sections.push(
      "",
      `## Source spec (${input.sourceSpec.path})`,
      "",
      input.sourceSpec.markdown.trimEnd(),
    );
  }

  sections.push("", "## Brief", "", input.brief.trimEnd(), "");
  return sections.join("\n");
}
