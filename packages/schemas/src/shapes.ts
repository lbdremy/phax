import type { Either, ParseResult, Schema } from "effect";
import {
  SCHEMA_URL_BASE,
  compareReleases,
  isFormatId,
  isRelease,
  parseSchemaUrl,
  type FormatId,
} from "../../../src/schemas/schemaUrl.js";
import { PACKAGE_VERSION } from "./generated/index.js";
import { failure, fromEither, type ParseFailure, type ParsedShape } from "./parsed.js";

const PACKAGE_NAME = "@lbdremy/phax-schemas";

/** One shape of a format: its schema and the decoder that reads it. */
export interface Shape<T> {
  readonly schema: Schema.Schema.AnyNoContext & { readonly Type: T };
  readonly decode: (input: unknown) => Either.Either<T, ParseResult.ParseError>;
}

type ShapeId<M> = keyof M & string;
type LegacyLiteral<K> = K extends `v${infer N extends number}` ? N : never;
type ReleaseName<K> = K extends `${number}.${number}.${number}` ? K : never;
type ReleaseEntries<M> = { [K in ShapeId<M> as ReleaseName<K>]: readonly [K, Shape<M[K]>] };
type ReleaseEntry<M> = ReleaseEntries<M>[keyof ReleaseEntries<M>];

/**
 * A format's table of shapes, over `M`: shape id → value type.
 * - `legacy` maps a `version` literal `N` to the frozen module of shape `v<N>`;
 * - `releases` maps a release to the frozen module of the shape it introduced;
 * - `current` is decoded by phax's own decoder; its name is `v<N>`, `next` or
 *   a release.
 */
export interface FormatSpec<M> {
  readonly id: FormatId;
  readonly label: string;
  readonly legacy: { readonly [K in ShapeId<M> as LegacyLiteral<K>]?: Shape<M[K]> };
  readonly releases: ReadonlyArray<ReleaseEntry<M>>;
  readonly current: {
    [K in ShapeId<M>]: { readonly name: K; readonly shape: Shape<M[K]> };
  }[ShapeId<M>];
}

export interface FormatDefinition<M> extends FormatSpec<M> {
  readonly packageVersion: string;
  /** Reads one value as this format. Never throws. */
  readonly parse: (input: unknown) => ParsedShape<M>;
}

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
  return `${formatId} written by phax ${release} is newer than ${PACKAGE_NAME} ${packageVersion} — upgrade the package`;
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
 *    another format and newer-than-the-package fail at `$schema`; a `next`
 *    current shape decodes first when the release is the package's own; else
 *    the latest release-named shape at or below the release decodes it;
 * 3. a document with a `version` literal resolves by it. When the current
 *    shape is `v<N>`, phax's own decoder reads it first; if that rejects it
 *    and `legacy[N]` exists, the frozen module reads it as the same shape
 *    `v<N>`, and if both reject it the current decoder's failure is returned.
 *    Any other literal is read by `legacy[N]`; an unknown literal fails at
 *    `version`. `0` is never a known literal: shape `v0` has no marker;
 * 4. a document with neither resolves to `v0` when the format has that
 *    unversioned shape (`current.name === "v0"` or `legacy[0]`), read as in
 *    step 3: the current decoder first, then the frozen module;
 * 5. otherwise a document with neither fails at `$schema`.
 */
export function defineFormat<M>(
  spec: FormatSpec<M>,
  options: { readonly packageVersion?: string } = {},
): FormatDefinition<M> {
  const packageVersion = options.packageVersion ?? PACKAGE_VERSION;
  const { id, label } = spec;
  const current = spec.current as { readonly name: string; readonly shape: AnyShape };
  const legacy = spec.legacy as Readonly<Record<number, AnyShape | undefined>>;
  const releases = spec.releases as ReadonlyArray<readonly [string, AnyShape]>;
  const releaseShapes = isRelease(current.name)
    ? [...releases, [current.name, current.shape] as const]
    : releases;
  const shapeLiterals = [
    ...Object.keys(legacy).map(Number),
    ...(/^v\d+$/.test(current.name) ? [Number(current.name.slice(1))] : []),
  ];
  const hasUnversionedShape = shapeLiterals.includes(0);
  const knownLiterals = shapeLiterals
    .filter((literal, index, all) => literal !== 0 && all.indexOf(literal) === index)
    .toSorted((a, b) => a - b);

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
    if (current.name === "next" && release === packageVersion) {
      const next = decodeAs("next", current.shape, input);
      if (next.ok) return next;
    }
    const [latest] = releaseShapes
      .filter(([name]) => compareReleases(name, release) <= 0)
      .toSorted(([a], [b]) => compareReleases(b, a));
    if (latest === undefined)
      return failure("$schema", `no ${id} shape is known at release ${release}`);
    return decodeAs(latest[0], latest[1], input);
  }

  /** Reads shape `v<literal>`: the current decoder first when it is that shape, then the frozen module. */
  function byShapeLiteral(literal: number, input: object): Decoded {
    const name = `v${literal}`;
    const entry = legacy[literal];
    if (current.name === name) {
      const read = decodeAs(name, current.shape, input);
      if (read.ok || entry === undefined) return read;
      const older = decodeAs(name, entry, input);
      return older.ok ? older : read;
    }
    return entry === undefined
      ? failure("version", `no ${label} shape ${name} is known`)
      : decodeAs(name, entry, input);
  }

  function byLiteral(version: unknown, input: object): Decoded {
    if (typeof version === "number" && knownLiterals.includes(version)) {
      return byShapeLiteral(version, input);
    }
    return failure(
      "version",
      knownLiterals.length === 0
        ? `unknown ${label} version ${describe(version)} — a ${label} carries no version literal`
        : `unknown ${label} version ${describe(version)} — known versions are ${knownLiterals.join(", ")}`,
    );
  }

  function parse(input: unknown): Decoded {
    if (!isDocumentObject(input)) return failure("", notAnObjectMessage(label, input));
    if (Object.hasOwn(input, "$schema")) return bySchemaUrl(input["$schema"], input);
    if (Object.hasOwn(input, "version")) return byLiteral(input["version"], input);
    if (hasUnversionedShape) return byShapeLiteral(0, input);
    return failure(
      "$schema",
      `missing $schema — a ${label} names its shape with a $schema URL or a version literal`,
    );
  }

  return {
    ...spec,
    packageVersion,
    parse: parse as (input: unknown) => ParsedShape<M>,
  };
}
