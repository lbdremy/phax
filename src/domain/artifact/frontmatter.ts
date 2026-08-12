import { Either, type ParseResult } from "effect";
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

function parseYamlMapping(yamlText: string): Either.Either<Document, FrontmatterProblem> {
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) {
    return Either.left({
      kind: "yaml-syntax",
      detail: doc.errors.map((error) => error.message).join("; "),
    });
  }
  if (!isMap(doc.contents)) {
    return Either.left({
      kind: "yaml-syntax",
      detail: "frontmatter block is not a YAML mapping",
    });
  }
  return Either.right(doc);
}

export function decodeArtifactFrontmatter(
  kind: ArtifactKind,
  md: string,
): Either.Either<SpecFrontmatter | PlanFrontmatter, FrontmatterProblem> {
  const split = splitFrontmatter(md);
  if (split === null) return Either.left({ kind: "missing-block" });

  const docE = parseYamlMapping(split.yamlText);
  if (Either.isLeft(docE)) return Either.left(docE.left);

  const value: unknown = docE.right.toJS();
  const decoded: Either.Either<SpecFrontmatter | PlanFrontmatter, ParseResult.ParseError> =
    kind === "spec" ? decodeSpecFrontmatter(value) : decodePlanFrontmatter(value);
  if (Either.isLeft(decoded)) {
    return Either.left({ kind: "schema", detail: formatParseError(decoded.left) });
  }
  return Either.right(decoded.right);
}

export function setFrontmatterKeys(
  md: string,
  edits: readonly FrontmatterEdit[],
): Either.Either<string, FrontmatterProblem> {
  const split = splitFrontmatter(md);
  if (split === null) return Either.left({ kind: "missing-block" });

  const docE = parseYamlMapping(split.yamlText);
  if (Either.isLeft(docE)) return Either.left(docE.left);

  const doc = docE.right;
  for (const edit of edits) {
    if (edit.key === "status") {
      doc.set("status", edit.value);
    } else {
      doc.set("approved", { date: edit.value.date, baseline: edit.value.baseline });
    }
  }

  return Either.right(`${DELIMITER}\n${doc.toString()}${DELIMITER}\n${split.body}`);
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
  if (Either.isLeft(docE)) return md;

  const doc = docE.right;
  doc.delete("status");
  doc.delete("approved");

  return `${DELIMITER}\n${doc.toString()}${DELIMITER}\n${split.body}`;
}
