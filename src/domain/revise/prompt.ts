import { type SidecarDocument, serializeSidecar } from "../artifact/sidecar.js";

// The writer's prompts for `phax artifact revise`: pure text.

export interface RevisePromptInput {
  readonly kind: "spec" | "plan";
  readonly artifactPath: string;
  /** `new` starts a session that holds nothing; `resume` continues the kept authoring session. */
  readonly session: "new" | "resume";
  readonly skillText: string;
  readonly brief: string | null;
  readonly document: SidecarDocument;
  readonly amendment: string;
  readonly schemaUrl: string;
}

function rules(kind: "spec" | "plan", schemaUrl: string): string {
  return [
    `You are revising a Draft ${kind}: carry the amendment below into the current document.`,
    "",
    "Rules:",
    `- Return the whole revised document as one JSON object, as your final message alone, with "$schema" equal to ${schemaUrl}.`,
    "- Carry the amendment into the body wherever it applies, and leave everything else as it is.",
    "- Never change, remove or reorder a question, open or arbitrated.",
    "- A new ambiguity the amendment raises may be appended at the end of the open questions, under an id the document does not use.",
    "- `sourceSpec`, `completesSpec` and the frontmatter are not revised.",
    "- Write no files: this session is read-only.",
  ].join("\n");
}

/** The prompt of the writer's first turn. */
export function buildRevisePrompt(input: RevisePromptInput): string {
  const parts: string[] = [];
  if (input.session === "new") {
    parts.push(input.skillText.trimEnd());
    if (input.brief !== null) {
      parts.push("## The brief this artifact was authored from\n\n" + input.brief.trimEnd());
    }
  }
  parts.push(rules(input.kind, input.schemaUrl));
  parts.push(
    "## The current document (" +
      input.artifactPath +
      ")\n\n" +
      serializeSidecar(input.document).trimEnd(),
  );
  parts.push("## The amendment\n\n" + input.amendment);
  return parts.join("\n\n") + "\n";
}

/** The prompt of the one corrective resume: the refusal, then the same rules. */
export function buildReviseRetryPrompt(refusal: string): string {
  return [
    `Your revised document was refused: ${refusal}`,
    "",
    "Return the whole revised document again as one JSON object, as your final message alone, under the same rules: carry the amendment, leave everything else as it is, never change, remove or reorder a question, append new questions only at the end of the open questions under new ids, leave `sourceSpec`, `completesSpec` and the frontmatter alone, and write no files.",
  ].join("\n");
}
