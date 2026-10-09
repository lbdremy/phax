import type { Either, ParseResult, Schema } from "effect";
import {
  SCHEMA_URL_BASE,
  compareReleases,
  isFormatId,
  isRelease,
  parseSchemaUrl,
  type FormatId,
  type PreSchemaFormatId,
  type SchemaBornFormatId,
} from "../../../src/schemas/schemaUrl.js";
import {
  FIRST_SUPPORTED_RELEASE,
  PACKAGE_VERSION,
  type CURRENT_SHAPES,
} from "./generated/index.js";
import { failure, fromEither, type ParseFailure, type ParsedShape } from "./parsed.js";

const PACKAGE_NAME = "@lbdremy/phax-schemas";

/**
 * The name of a format's current shape, as its snapshots record it: `next`
 * until a release renames it to that release. Keys every shape map's current
 * entry, so renaming a snapshot renames the shape.
 */
export type CurrentShapeName<F extends FormatId> = (typeof CURRENT_SHAPES)[F];

/** One shape of a format: its schema and the decoder that reads it. */
export interface Shape<T> {
  readonly schema: Schema.Schema.AnyNoContext & { readonly Type: T };
  readonly decode: (input: unknown) => Either.Either<T, ParseResult.ParseError>;
}

type ShapeId<M> = keyof M & string;
type ReleaseName<K> = K extends `${number}.${number}.${number}` ? K : never;
type ReleaseEntries<M> = { [K in ShapeId<M> as ReleaseName<K>]: readonly [K, Shape<M[K]>] };
type ReleaseEntry<M> = ReleaseEntries<M>[keyof ReleaseEntries<M>];
type PreSchemaValue<M> = M extends { readonly "pre-schema": infer T } ? T : never;
type NamedShape<M, K extends ShapeId<M>> = {
  [N in K]: { readonly name: N; readonly shape: Shape<M[N]> };
}[K];

/**
 * A format whose pre-schema slot is unfilled: phax's current decoder is the
 * pre-schema decoder, and no release has written `$schema` yet.
 */
interface CurrentPreSchemaSpec<M> {
  readonly id: PreSchemaFormatId;
  readonly label: string;
  readonly preSchema?: never;
  readonly releases: readonly [];
  readonly current: { readonly name: "pre-schema"; readonly shape: Shape<PreSchemaValue<M>> };
}

/**
 * A format whose pre-schema shape is frozen: `preSchema` reads every document
 * without `$schema`, `releases` maps a release to the frozen module of the
 * shape it introduced, and `current` is phax's own decoder, named `next` or a
 * release.
 */
interface FrozenPreSchemaSpec<M> {
  readonly id: PreSchemaFormatId;
  readonly label: string;
  readonly preSchema: Shape<PreSchemaValue<M>>;
  readonly releases: ReadonlyArray<ReleaseEntry<M>>;
  readonly current: NamedShape<M, Extract<ShapeId<M>, "next"> | ReleaseName<ShapeId<M>>>;
}

/**
 * A format born with `$schema`: phax wrote every document of it with one, so
 * it has no pre-schema shape (`preSchema: null`) and its map no `pre-schema`
 * key. `releases` and `current` are as for a frozen pre-schema format.
 */
interface SchemaBornSpec<M> {
  readonly id: SchemaBornFormatId;
  readonly label: string;
  readonly preSchema: null;
  readonly releases: ReadonlyArray<ReleaseEntry<M>>;
  readonly current: NamedShape<M, Extract<ShapeId<M>, "next"> | ReleaseName<ShapeId<M>>>;
}

/**
 * A format's table of shapes, over `M`: shape id → value type. A format phax
 * wrote before it wrote `$schema` has a `pre-schema` shape; a format born
 * with `$schema` has none.
 */
export type FormatSpec<M> = CurrentPreSchemaSpec<M> | FrozenPreSchemaSpec<M> | SchemaBornSpec<M>;

export type FormatDefinition<M> = FormatSpec<M> & {
  readonly packageVersion: string;
  /** Reads one value as this format. Never throws. */
  readonly parse: (input: unknown) => ParsedShape<M>;
};

/** Marks a fact an older shape never recorded; an upgrade never invents it. */
export type Unknown = { readonly kind: "unknown" };

export const UNKNOWN: Unknown = Object.freeze({ kind: "unknown" });

export function isUnknown(value: unknown): value is Unknown {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { readonly kind?: unknown }).kind === "unknown"
  );
}

export function unknownFormatMessage(url: string, packageVersion: string): string {
  return `${url} names a format unknown to ${PACKAGE_NAME} ${packageVersion} — upgrade the package`;
}

export function newerReleaseMessage(
  formatId: string,
  release: string,
  packageVersion: string,
): string {
  return `${formatId} ${release} is newer than ${PACKAGE_NAME} ${packageVersion} — upgrade the package`;
}

/**
 * A `$schema` document below the first supported release: only a development
 * build stamps `$schema` before the first release that writes it.
 */
export function developmentBuildMessage(url: string, firstSupportedRelease: string): string {
  return `${url} was written by a development build of phax before ${firstSupportedRelease}, the first supported release — not supported`;
}

/**
 * A document without `$schema` that the pre-schema decoder rejects. Names the
 * first supported release once one is known (`FIRST_SUPPORTED_RELEASE`).
 */
export function preSchemaUnsupportedMessage(
  label: string,
  violation: string,
  firstSupportedRelease: string | null,
): string {
  const older =
    firstSupportedRelease === null
      ? "older than the first release that writes $schema"
      : `older than phax ${firstSupportedRelease}, the first supported release`;
  return `${label} ${older} — not supported (${violation})`;
}

/** A document without `$schema` of a format born with `$schema`. */
export function missingSchemaMessage(label: string): string {
  return `${label} has no $schema — every ${label} is written with one`;
}

function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `a value of type ${typeof value}`;
}

export function malformedSchemaUrlMessage(url: unknown): string {
  return `expected ${SCHEMA_URL_BASE}/<format-id>/<X.Y.Z>.json, got ${describe(url)}`;
}

export function notAnObjectMessage(label: string, value: unknown): string {
  return `a ${label} is a JSON object, got ${describe(value)}`;
}

/** A JSON object: not null, not an array. */
export function isDocumentObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type AnyShape = Shape<unknown>;
type Decoded =
  | { readonly ok: true; readonly shape: string; readonly value: unknown }
  | ParseFailure;

function decodeAs(shape: string, entry: AnyShape, input: unknown): Decoded {
  const result = fromEither(entry.decode(input));
  return result.ok ? { ok: true, shape, value: result.value } : result;
}

/**
 * Defines a format from its shape table. `parse` resolves a document to one
 * shape, in order:
 * 1. a non-object fails at `""`;
 * 2. a document with `$schema` resolves by the URL: malformed, unknown format,
 *    another format and newer-than-the-package fail at `$schema`; a release
 *    below `firstSupportedRelease`, when one is known, fails at `$schema` with
 *    `developmentBuildMessage` and no decoder tries it, not even the
 *    pre-schema one; when the current shape is `next` and the release is the
 *    package's own, `next` alone decodes it and its violation is the failure,
 *    with no released shape tried; else the latest release-named shape at or
 *    below the release decodes it; else it fails at `$schema` (`no <id> shape
 *    is known at release <X>`);
 * 3. a document without `$schema`, whatever its `version`, is read only by
 *    the pre-schema decoder: the frozen `preSchema` module when the slot is
 *    filled, else `current.shape`. It resolves to shape `pre-schema`, or fails
 *    at the decoder's first violation with `preSchemaUnsupportedMessage`. No
 *    other decoder is tried. For a format born with `$schema`
 *    (`preSchema: null`) it fails at `$schema` with `missingSchemaMessage`,
 *    and no decoder is tried.
 *
 * `packageVersion` defaults to `PACKAGE_VERSION` and `firstSupportedRelease`
 * to `FIRST_SUPPORTED_RELEASE`; tests inject both.
 */
export function defineFormat<M>(
  spec: FormatSpec<M>,
  options: {
    readonly packageVersion?: string;
    readonly firstSupportedRelease?: string | null;
  } = {},
): FormatDefinition<M> {
  const packageVersion = options.packageVersion ?? PACKAGE_VERSION;
  const firstSupportedRelease =
    options.firstSupportedRelease === undefined
      ? FIRST_SUPPORTED_RELEASE
      : options.firstSupportedRelease;
  const { id, label } = spec;
  const current = spec.current as { readonly name: string; readonly shape: AnyShape };
  const releases = spec.releases as ReadonlyArray<readonly [string, AnyShape]>;
  const preSchema =
    spec.preSchema === null ? null : ((spec.preSchema ?? current.shape) as AnyShape);
  const releaseShapes = isRelease(current.name)
    ? [...releases, [current.name, current.shape] as const]
    : releases;

  function bySchemaUrl(url: unknown, input: object): Decoded {
    const parsed = parseSchemaUrl(url);
    if (parsed === undefined) {
      return failure("$schema", malformedSchemaUrlMessage(url));
    }
    const { formatId, release } = parsed;
    const href = url as string;
    if (!isFormatId(formatId))
      return failure("$schema", unknownFormatMessage(href, packageVersion));
    if (formatId !== id)
      return failure("$schema", `${href} is a ${formatId} document, not a ${id}`);
    if (compareReleases(release, packageVersion) > 0) {
      return failure("$schema", newerReleaseMessage(id, release, packageVersion));
    }
    if (firstSupportedRelease !== null && compareReleases(release, firstSupportedRelease) < 0) {
      return failure("$schema", developmentBuildMessage(href, firstSupportedRelease));
    }
    if (current.name === "next" && release === packageVersion) {
      return decodeAs("next", current.shape, input);
    }
    const [latest] = releaseShapes
      .filter(([name]) => compareReleases(name, release) <= 0)
      .toSorted(([a], [b]) => compareReleases(b, a));
    if (latest !== undefined) return decodeAs(latest[0], latest[1], input);
    return failure("$schema", `no ${id} shape is known at release ${release}`);
  }

  function byPreSchema(input: object): Decoded {
    if (preSchema === null) return failure("$schema", missingSchemaMessage(label));
    const read = decodeAs("pre-schema", preSchema, input);
    if (read.ok) return read;
    return failure(
      read.error.path,
      preSchemaUnsupportedMessage(label, read.error.message, firstSupportedRelease),
    );
  }

  function parse(input: unknown): Decoded {
    if (!isDocumentObject(input)) return failure("", notAnObjectMessage(label, input));
    if (Object.hasOwn(input, "$schema")) return bySchemaUrl(input["$schema"], input);
    return byPreSchema(input);
  }

  return {
    ...spec,
    packageVersion,
    parse: parse as (input: unknown) => ParsedShape<M>,
  };
}
