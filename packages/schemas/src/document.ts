import { isFormatId, parseSchemaUrl, type FormatId } from "../../../src/schemas/schemaUrl.js";
import { PACKAGE_VERSION } from "./generated/index.js";
import { failure, type ParsedDocument, type ParsedShape } from "./parsed.js";
import {
  isDocumentObject,
  malformedSchemaUrlMessage,
  notAnObjectMessage,
  unknownFormatMessage,
  type FormatDefinition,
} from "./shapes.js";

/** The formats a document parser reads, keyed by format id. */
export type DocumentDefinitions<M> = {
  readonly [F in keyof M]: FormatDefinition<M[F]>;
};

export const MISSING_SCHEMA_MESSAGE =
  "missing $schema — a pre-schema document is identified by where it lives; read it with its format's parse function (for example, parsePhaseRecordManifest or parseGateAttribution)";

/**
 * Builds a parser that identifies a document by its `$schema` URL alone, never
 * by a file name or location. It takes one value and never throws:
 * 1. a non-object fails at `""`;
 * 2. a document without `$schema` fails at `$schema`, pointing to the format's
 *    own parse function;
 * 3. a malformed URL fails at `$schema`;
 * 4. an id outside `FORMAT_IDS`, or one with no definition here, fails with
 *    the upgrade-the-package message;
 * 5. otherwise the format's own `parse` reads it, and the success names the
 *    format.
 */
export function makeDocumentParser<M extends Partial<Record<FormatId, unknown>>>(
  definitions: DocumentDefinitions<M>,
  options: { readonly packageVersion?: string } = {},
): (input: unknown) => ParsedDocument<M> {
  const packageVersion = options.packageVersion ?? PACKAGE_VERSION;
  const byId = definitions as Readonly<
    Record<string, { readonly parse: (input: unknown) => ParsedShape<Record<string, unknown>> }>
  >;

  function parseDocument(input: unknown) {
    if (!isDocumentObject(input)) return failure("", notAnObjectMessage("document", input));
    if (!Object.hasOwn(input, "$schema")) return failure("$schema", MISSING_SCHEMA_MESSAGE);
    const url = input["$schema"];
    const parsed = parseSchemaUrl(url);
    if (parsed === undefined) return failure("$schema", malformedSchemaUrlMessage(url));
    const definition =
      isFormatId(parsed.formatId) && Object.hasOwn(byId, parsed.formatId)
        ? byId[parsed.formatId]
        : undefined;
    if (definition === undefined) {
      return failure("$schema", unknownFormatMessage(url as string, packageVersion));
    }
    const result = definition.parse(input);
    if (!result.ok) return result;
    return { ok: true, format: parsed.formatId, shape: result.shape, value: result.value };
  }

  return parseDocument as (input: unknown) => ParsedDocument<M>;
}
