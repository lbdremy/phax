import { createHash } from "node:crypto";
import { Either } from "effect";
import type { ArtifactKind } from "../artifact/status.js";
import { PHAX_DECIDE_PLAN_SKILL, PHAX_DECIDE_SPEC_SKILL } from "../skills/catalog.js";

/** The doctrine skill a decide session loads, by the kind of artifact it decides. */
export const DECIDE_SKILL_FOR_KIND: Readonly<Record<ArtifactKind, string>> = {
  spec: PHAX_DECIDE_SPEC_SKILL,
  plan: PHAX_DECIDE_PLAN_SKILL,
};

type DoctrineSource =
  | {
      readonly kind: "skill";
      readonly name: string;
      readonly source: "bundled" | "project";
      readonly fingerprint: string;
    }
  | { readonly kind: "file"; readonly path: string; readonly fingerprint: string };

/**
 * The instructions a decide session follows: the doctrine skill's text, then
 * the `--doctrine` file under its own heading. `principleIds` are the ids a
 * verdict may cite; `sources` say where the text came from, each with the
 * sha256 of its text.
 */
export interface Doctrine {
  readonly text: string;
  readonly principleIds: ReadonlySet<string>;
  readonly sources: readonly DoctrineSource[];
}

export interface DoctrineSkillInput {
  readonly name: string;
  readonly source: "bundled" | "project";
  readonly text: string;
}

export interface DoctrineFileInput {
  readonly path: string;
  readonly text: string;
}

const FENCE = /^\s*(`{3,}|~{3,})/;
// Optional indentation, a bullet (`-`, `*`, `+`) or an ordered marker (`1.`,
// `1)`), then a backticked id as the first thing in the item's content.
const LIST_ITEM_ID = /^\s*(?:[-*+]|\d+[.)])\s+`([A-Za-z][A-Za-z0-9]*)`/;

/**
 * The citable principle ids of a doctrine text: the backticked ids that open
 * list items, in document order, deduplicated. Only the opening id counts — a
 * parenthesised id after it, or an id named later in the item's prose, is not
 * citable. Lines inside fenced code blocks are skipped.
 */
export function principleIdsOf(text: string): readonly string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let fence: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const id = LIST_ITEM_ID.exec(line)?.[1];
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Assembles a decide session's doctrine from the skill and the optional
 * `--doctrine` file. Refuses a file that defines no principle id, or one that
 * redefines an id the skill already defines (every overlapping id is named).
 */
export function assembleDoctrine(input: {
  readonly skill: DoctrineSkillInput;
  readonly file: DoctrineFileInput | null;
}): Either.Either<Doctrine, string> {
  const { skill, file } = input;
  const skillIds = principleIdsOf(skill.text);
  const skillSource: DoctrineSource = {
    kind: "skill",
    name: skill.name,
    source: skill.source,
    fingerprint: fingerprint(skill.text),
  };
  if (file === null) {
    return Either.right({
      text: skill.text,
      principleIds: new Set(skillIds),
      sources: [skillSource],
    });
  }
  const fileIds = principleIdsOf(file.text);
  if (fileIds.length === 0) {
    return Either.left(
      `doctrine file ${file.path} defines no principle id: no list item opens with a backticked id`,
    );
  }
  const skillIdSet = new Set(skillIds);
  const overlap = fileIds.filter((id) => skillIdSet.has(id));
  if (overlap.length > 0) {
    return Either.left(
      `doctrine file ${file.path} redefines ${overlap.map((id) => `\`${id}\``).join(", ")}, already defined by the ${skill.name} skill`,
    );
  }
  const separator = skill.text.endsWith("\n") ? "\n" : "\n\n";
  return Either.right({
    text: `${skill.text}${separator}## Project doctrine (${file.path})\n\n${file.text}`,
    principleIds: new Set([...skillIds, ...fileIds]),
    sources: [skillSource, { kind: "file", path: file.path, fingerprint: fingerprint(file.text) }],
  });
}
