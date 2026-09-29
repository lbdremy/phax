// Reads the committed shape survey (docs/briefs/schemas-package-shapes.json)
// and the fixtures keyed by its signatures: one real document per surveyed
// key signature, in tests/unit/schemasPackage/fixtures/<format id>/<shape>.json.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

/** One (version literal, key signature) group of the survey. */
export interface SurveyGroup {
  readonly keys: string;
  readonly accepted: number;
  readonly rejected: number;
}

interface SurveyReport {
  readonly formats: Readonly<
    Record<string, { readonly groups: ReadonlyArray<SurveyGroup & Record<string, unknown>> }>
  >;
}

const report = JSON.parse(
  readFileSync(join(repoRoot, "docs/briefs/schemas-package-shapes.json"), "utf8"),
) as SurveyReport;

/** Every group the survey found for a format: its signature and phax's verdicts. */
export function surveyGroups(formatId: FormatId): ReadonlyArray<SurveyGroup> {
  const format = report.formats[formatId];
  if (format === undefined) throw new Error(`the survey has no format ${formatId}`);
  return format.groups.map(({ keys, accepted, rejected }) => ({ keys, accepted, rejected }));
}

/** The fixture documents of one format and shape, each with the signature it is keyed by. */
export function readSurveyedFixtures(
  formatId: FormatId,
  shape: string,
): ReadonlyArray<{ readonly signature: string; readonly document: unknown }> {
  const path = join(here, "fixtures", formatId, `${shape}.json`);
  const fixtures = JSON.parse(readFileSync(path, "utf8")) as Readonly<Record<string, unknown>>;
  return Object.entries(fixtures).map(([signature, document]) => ({ signature, document }));
}

function sortedKeys(keys: Iterable<string>): string {
  return [...keys].toSorted().join(",");
}

/**
 * A document's key signature, computed as scripts/survey-format-shapes.ts
 * does: its top-level keys, sorted, with one level of nested keys for objects
 * and for arrays of objects. A table keyed by paths or names is described by
 * the keys of its values.
 */
export function keySignature(document: unknown): string {
  const object = document as Readonly<Record<string, unknown>>;
  return Object.keys(object)
    .toSorted()
    .map((key) => {
      const value = object[key];
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const inner = Object.keys(value);
        if (inner.length > 0 && inner.every((name) => /[/.]/.test(name))) {
          const union = new Set<string>();
          for (const entry of Object.values(value)) {
            if (typeof entry === "object" && entry !== null) {
              for (const name of Object.keys(entry)) union.add(name);
            }
          }
          return `${key}{*:{${sortedKeys(union)}}}`;
        }
        return `${key}{${sortedKeys(inner)}}`;
      }
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        value.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))
      ) {
        const union = new Set<string>();
        for (const item of value as ReadonlyArray<object>) {
          for (const name of Object.keys(item)) union.add(name);
        }
        return `${key}[{${sortedKeys(union)}}]`;
      }
      return key;
    })
    .join(" ");
}
