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
  readonly slug: string;
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
    `- Return ONLY a JSON object valid against the ${documentName} JSON Schema below.`,
    "- No code fences, no Markdown, no commentary before or after the JSON.",
    "- Write no files: phax renders the Markdown artifact from your JSON, writes it and commits it.",
    "- The JSON object is your final message.",
    ...(input.sourceSpec !== null
      ? [`- Set \`sourceSpec\` to \`${input.sourceSpec.path}\`.`]
      : input.kind === "plan"
        ? ["- Set `sourceSpec` to null: this plan has no source spec."]
        : []),
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
