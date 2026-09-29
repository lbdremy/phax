/**
 * The `$schema` URL that names a persisted document's format and the phax
 * release that wrote it: `<base>/<format-id>/<X.Y.Z>.json`. Pure, and
 * imports nothing, so the schemas package can carry it.
 */
export const SCHEMA_URL_BASE = "https://docs.phax.run/schemas";

/**
 * Every persisted format of spec §4. `code-review` joins with the
 * headless-review plan, which ships that document.
 */
export const FORMAT_IDS = [
  "registry",
  "run-status",
  "phase-status",
  "phax-plan",
  "compliance-review",
  "plan-approvals",
  "spec-approvals",
  "phase-record-manifest",
  "authoring-record-manifest",
  "gate-attribution",
  "phase-file-reconciliation",
  "gate-diagnostics",
  "gate-pending",
  "spec-document",
  "plan-document",
] as const;

export type FormatId = (typeof FORMAT_IDS)[number];

export function isFormatId(value: string): value is FormatId {
  return (FORMAT_IDS as ReadonlyArray<string>).includes(value);
}

const RELEASE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

/** A release string: a numeric `X.Y.Z` triple. */
export function isRelease(value: string): boolean {
  return RELEASE.test(value);
}

export function schemaUrl(formatId: FormatId, release: string): string {
  return `${SCHEMA_URL_BASE}/${formatId}/${release}.json`;
}

// Any lowercase-kebab id is accepted, so that an id unknown to this build
// stays reportable by name rather than reading as a malformed URL.
const SCHEMA_URL = new RegExp(
  `^${SCHEMA_URL_BASE.replaceAll(".", "\\.")}/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/([0-9.]+)\\.json$`,
);

export function parseSchemaUrl(value: unknown): { formatId: string; release: string } | undefined {
  if (typeof value !== "string") return undefined;
  const match = SCHEMA_URL.exec(value);
  const formatId = match?.[1];
  const release = match?.[2];
  if (formatId === undefined || release === undefined || !isRelease(release)) return undefined;
  return { formatId, release };
}

/** Orders two `X.Y.Z` releases numerically: negative, zero or positive. */
export function compareReleases(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
