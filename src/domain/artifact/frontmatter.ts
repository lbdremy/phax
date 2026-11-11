import { Result, type Schema } from "effect";
import { isMap, parseDocument, type Document } from "yaml";
import { formatParseError } from "../../schemas/formatError.js";
import {
  decodePlanFrontmatter,
  decodeSpecFrontmatter,
  type PlanFrontmatter,
  type SpecFrontmatter,
} from "../../schemas/artifactFrontmatter.js";
import type { ArtifactKind } from "./status.js";

export interface FrontmatterSplit {
  readonly yamlText: string;
  readonly body: string;
}

const DELIMITER = "---";

/**
 * Splits a document into its YAML frontmatter text and body, or `null` if the
 * document does not begin with an exact `---` delimiter line at offset 0.
 */
export function splitFrontmatter(md: string): FrontmatterSplit | null {
  if (!md.startsWith(`${DELIMITER}\n`)) return null;
  const lines = md.split("\n");
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === DELIMITER) {
      closeIndex = i;
      break;
    }
  }
  if (closeIndex === -1) return null;
  return {
    yamlText: lines.slice(1, closeIndex).join("\n"),
    body: lines.slice(closeIndex + 1).join("\n"),
  };
}

export type FrontmatterProblem =
  | { readonly kind: "missing-block" }
  | { readonly kind: "yaml-syntax"; readonly detail: string }
  | { readonly kind: "schema"; readonly detail: string };

export type FrontmatterEdit =
  | { readonly key: "status"; readonly value: string }
  | {
      readonly key: "approved";
      readonly value: { readonly date: string; readonly baseline: string };
    };

function parseYamlMapping(yamlText: string): Result.Result<Document, FrontmatterProblem> {
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return Result.fail({
      kind: "yaml-syntax",
      detail: doc.errors.map((error) => error.message).join("; "),
    });
  }
  if (!isMap(doc.contents)) {
    return Result.fail({
      kind: "yaml-syntax",
      detail: "frontmatter block is not a YAML mapping",
    });
  }
  return Result.succeed(doc);
}

export function decodeArtifactFrontmatter(
  kind: "spec",
  md: string,
): Result.Result<SpecFrontmatter, FrontmatterProblem>;
export function decodeArtifactFrontmatter(
  kind: "plan",
  md: string,
): Result.Result<PlanFrontmatter, FrontmatterProblem>;
export function decodeArtifactFrontmatter(
  kind: ArtifactKind,
  md: string,
): Result.Result<SpecFrontmatter | PlanFrontmatter, FrontmatterProblem>;
export function decodeArtifactFrontmatter(
  kind: ArtifactKind,
  md: string,
): Result.Result<SpecFrontmatter | PlanFrontmatter, FrontmatterProblem> {
  const split = splitFrontmatter(md);
  if (split === null) return Result.fail({ kind: "missing-block" });

  const docE = parseYamlMapping(split.yamlText);
  if (Result.isFailure(docE)) return Result.fail(docE.failure);

  const value: unknown = docE.success.toJS();
  const decoded: Result.Result<SpecFrontmatter | PlanFrontmatter, Schema.SchemaError> =
    kind === "spec" ? decodeSpecFrontmatter(value) : decodePlanFrontmatter(value);
  if (Result.isFailure(decoded)) {
    return Result.fail({ kind: "schema", detail: formatParseError(decoded.failure) });
  }
  return Result.succeed(decoded.success);
}

export function setFrontmatterKeys(
  md: string,
  edits: readonly FrontmatterEdit[],
): Result.Result<string, FrontmatterProblem> {
  const split = splitFrontmatter(md);
  if (split === null) return Result.fail({ kind: "missing-block" });

  const docE = parseYamlMapping(split.yamlText);
  if (Result.isFailure(docE)) return Result.fail(docE.failure);

  const doc = docE.success;
  for (const edit of edits) {
    if (edit.key === "status") {
      doc.set("status", edit.value);
    } else {
      doc.set("approved", { date: edit.value.date, baseline: edit.value.baseline });
    }
  }

  return Result.succeed(`${DELIMITER}\n${doc.toString()}${DELIMITER}\n${split.body}`);
}

/**
 * Deletes the named keys from the frontmatter block, the mirror of
 * {@link setFrontmatterKeys}: re-emits the block with the body byte-identical.
 * Deleting a key that is absent is a no-op, not an error. Kept as its own
 * operation rather than a delete variant of the `FrontmatterEdit` union.
 */
export function removeFrontmatterKeys(
  md: string,
  keys: readonly string[],
): Result.Result<string, FrontmatterProblem> {
  const split = splitFrontmatter(md);
  if (split === null) return Result.fail({ kind: "missing-block" });

  const docE = parseYamlMapping(split.yamlText);
  if (Result.isFailure(docE)) return Result.fail(docE.failure);

  const doc = docE.success;
  for (const key of keys) {
    doc.delete(key);
  }

  return Result.succeed(`${DELIMITER}\n${doc.toString()}${DELIMITER}\n${split.body}`);
}

/**
 * Returns the portion of the document that determines its approval
 * fingerprint: the frontmatter block with `status` and `approved` removed,
 * plus the raw body. Only callers fingerprint artifacts that validation has
 * already accepted, so a document with no frontmatter block (or one that
 * fails to parse) is returned verbatim rather than treated as an error here.
 */
export function fingerprintSource(md: string): string {
  const split = splitFrontmatter(md);
  if (split === null) return md;

  const docE = parseYamlMapping(split.yamlText);
  if (Result.isFailure(docE)) return md;

  const doc = docE.success;
  doc.delete("status");
  doc.delete("approved");

  return `${DELIMITER}\n${doc.toString()}${DELIMITER}\n${split.body}`;
}
