// The source half of the spec acceptance-tests' ac-oracle-kept scan: the words
// oracle and discharge may appear in the sources, the usage contract, the CLI
// reference and the current JSON Schemas only where spec §5.21 keeps them. Plan 4 (the docs and the example) widens SCANNED_ROOTS and
// SCANNED_FILES below to the README, docs, site, example and skills and
// claims the criterion; every entry here stays.
//
// Reads files only: no phax process, no network, no HOME.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Directories scanned recursively, as TypeScript sources. Plan 4 adds more. */
export const SCANNED_ROOTS: readonly string[] = ["src", "packages/schemas/src"];
/** Single files scanned beside the roots. Plan 4 adds more. */
export const SCANNED_FILES: readonly string[] = [
  "phax.usage.kdl",
  "docs/cli/reference.md",
  "phax.schema.json",
  "phax.user.schema.json",
];
/** Each format's current JSON Schema snapshot is scanned too; older ones are frozen. */
const SNAPSHOTS_DIR = "packages/schemas/snapshots";

/** The categories of §5.21 an entry's reason names. */
export type KeptCategory =
  | "frozen shape of an earlier release"
  | "reader or lift of an earlier shape"
  | "old-name refusal"
  | "retired oracle-request format id and exports"
  | "test line fourth field"
  | "wrong-oracle escape"
  | "prose about what judges a test";

export interface AllowEntry {
  readonly id: string;
  readonly reason: KeptCategory;
  /** A path glob relative to the repository root: `*` within a segment, `**` across segments. */
  readonly file: string;
  /**
   * Absent for a whole-file entry (frozen modules and readers or lifts only).
   * Each pattern allows only the words its own match spans, so an allowed
   * token never exempts another word on the same line, and each pattern must
   * still allow something, or the entry is stale.
   */
  readonly lines?: readonly RegExp[];
}

export const ALLOWLIST: readonly AllowEntry[] = [
  // ── Whole files: frozen modules and reader or lift modules.
  {
    id: "frozen-history",
    reason: "frozen shape of an earlier release",
    file: "src/schemas/history/**",
  },
  {
    id: "frozen-render-plan",
    reason: "frozen shape of an earlier release",
    file: "src/domain/authoring/renderPlanV0_*.ts",
  },
  {
    id: "reader-persisted",
    reason: "reader or lift of an earlier shape",
    file: "src/schemas/persisted.ts",
  },
  {
    id: "lift-acceptance",
    reason: "reader or lift of an earlier shape",
    file: "src/schemas/acceptanceLift.ts",
  },
  {
    id: "lift-format-record-manifests",
    reason: "reader or lift of an earlier shape",
    file: "packages/schemas/src/formats/recordManifests.ts",
    lines: [
      /could run an oracle phase/,
      /`oracle` role/,
      /"oracle" in value/,
      /oracle, mode/,
      /liftRecordRole\(oracle\)/,
    ],
  },

  // ── Lift comments in the package modules that also define current formats.
  {
    id: "lift-format-repository",
    reason: "reader or lift of an earlier shape",
    file: "packages/schemas/src/formats/repository.ts",
    lines: [/`oracle: \{ dischargedBy, files \}`/, /loop `oracle`/, /the `oracle` key/],
  },
  {
    id: "lift-format-run-directory",
    reason: "reader or lift of an earlier shape",
    file: "packages/schemas/src/formats/runDirectory.ts",
    lines: [
      /`mode` and `oracle`/,
      /hold selection `oracle`/,
      /`oracleStep` is lifted/,
      /`oracle: \{ dischargedBy/,
      /loop `oracle`/,
      /the `oracle` key/,
    ],
  },
  {
    id: "lift-format-record-timeline",
    reason: "reader or lift of an earlier shape",
    file: "packages/schemas/src/formats/recordTimeline.ts",
    lines: [/their `oracle` step/],
  },
  {
    id: "lift-format-answers",
    reason: "reader or lift of an earlier shape",
    file: "packages/schemas/src/formats/answers.ts",
    lines: [/loop `oracle`/],
  },
  {
    id: "lift-format-acceptance-request",
    reason: "retired oracle-request format id and exports",
    file: "packages/schemas/src/formats/acceptanceRequest.ts",
  },

  {
    id: "frozen-oracle-request-snapshot",
    reason: "retired oracle-request format id and exports",
    file: "packages/schemas/snapshots/oracle-request/*.schema.json",
  },

  // ── Readers of files an earlier release wrote.
  {
    id: "records-explain-old-stem",
    reason: "reader or lift of an earlier shape",
    file: "src/app/recordsExplain.ts",
    lines: [/oracle-request\.json/],
  },
  {
    id: "attempt-files-old-stem",
    reason: "reader or lift of an earlier shape",
    file: "src/domain/gate/attemptFiles.ts",
    lines: [/oracle-request\\?\.json/],
  },
  {
    id: "document-migration-own-shape",
    reason: "reader or lift of an earlier shape",
    file: "src/domain/artifact/documentMigration.ts",
    lines: [/test lines end `· oracle`/, /no oracle, no reason/],
  },
  {
    id: "plan-cache-key-history",
    reason: "reader or lift of an earlier shape",
    file: "src/domain/planCache/key.ts",
    lines: [/an earlier extractor read as `oracle`/],
  },

  // ── The retired oracle-request format id and its exports.
  {
    id: "schema-url-retired-format",
    reason: "retired oracle-request format id and exports",
    file: "src/schemas/schemaUrl.ts",
    lines: [/oracle-request/, /oracle request/, /oracle-phases/],
  },
  {
    id: "release-retired-format",
    reason: "retired oracle-request format id and exports",
    file: "src/schemas/release.ts",
    lines: [/"oracle-request"/],
  },
  {
    id: "generated-index-retired-format",
    reason: "retired oracle-request format id and exports",
    file: "packages/schemas/src/generated/index.ts",
    lines: [/"oracle-request"/],
  },
  {
    id: "schemas-package-retired-format",
    reason: "retired oracle-request format id and exports",
    file: "packages/schemas/src/index.ts",
    lines: [
      /oracleRequestFormat/,
      /OracleRequestShapes/,
      /OracleRequestV0_26_0/,
      /oracle-request/,
      /oracle request/,
    ],
  },
  {
    id: "acceptance-request-schema-retired-format",
    reason: "retired oracle-request format id and exports",
    file: "src/schemas/acceptanceRequest.ts",
    lines: [/`oracle-request`/],
  },

  // ── Old-name refusals.
  {
    id: "config-oracles-key",
    reason: "old-name refusal",
    file: "src/app/loadConfig.ts",
    lines: [/retiredOraclesKeyError/, /"oracles"/],
  },
  {
    id: "hold-oracle-selection",
    reason: "old-name refusal",
    file: "src/domain/hold.ts",
    lines: [/includes\("oracle"\)/, /--hold 'oracle' is no longer read/],
  },
  {
    id: "skip-oracle-option",
    reason: "old-name refusal",
    file: "src/cli/introspect.ts",
    lines: [/--skip-oracle/],
  },
  {
    id: "skip-oracle-register",
    reason: "old-name refusal",
    file: "src/cli/commands/resumeRegister.ts",
    lines: [/--skip-oracle/, /skipOracle/],
  },
  {
    id: "skip-oracle-resume",
    reason: "old-name refusal",
    file: "src/cli/commands/resume.ts",
    lines: [/--skip-oracle/, /skipOracle/],
  },
  {
    id: "lint-old-header-lines",
    reason: "old-name refusal",
    file: "src/app/lintPlan.ts",
    lines: [/hasOraclePhaseLine/, /hasOracleFilesLine/],
  },
  {
    id: "phase-header-old-labels",
    reason: "old-name refusal",
    file: "src/domain/plan/phaseHeader.ts",
    lines: [
      /Oracle phase/,
      /Oracle files/,
      /hasOraclePhaseLine/,
      /hasOracleFilesLine/,
      /old Oracle lines/,
      /Oracle lines/,
    ],
  },
  {
    id: "acceptance-check-old-lines",
    reason: "old-name refusal",
    file: "src/domain/plan/acceptanceCheck.ts",
    lines: [/Oracle phase/, /Oracle files/, /hasOraclePhaseLine/, /hasOracleFilesLine/],
  },
  {
    id: "test-line-check-retired",
    reason: "old-name refusal",
    file: "src/domain/plan/testLineCheck.ts",
    lines: [/\*\*Oracle phase:\*\*/, /\*\*Oracle files:\*\*/, /old loop `oracle`/],
  },
  {
    id: "test-line-grammar-retired-loop",
    reason: "old-name refusal",
    file: "src/domain/plan/testLineGrammar.ts",
    lines: [
      /its loop is `oracle`/,
      /loop `oracle`/,
      /`oracle` and `in-phase`/,
      /reads its `oracle` as/,
      /holds `oracle` as a criterion/,
      /\["oracle", "in-phase"\]/,
      /field === "oracle" \? liftTestLoop\("oracle"\)/,
      /uses the loop 'oracle', which is no longer read/,
    ],
  },
  {
    id: "test-line-criterion-filter",
    reason: "old-name refusal",
    file: "src/schemas/testLine.ts",
    lines: [
      /plus `oracle`\. `oracle`/,
      /\[\.\.\.TEST_LOOPS, "oracle"\]/,
      /'in-phase' nor 'oracle'/,
    ],
  },

  // ── The test line's fourth field.
  {
    id: "field-test-line-schema",
    reason: "test line fourth field",
    file: "src/schemas/testLine.ts",
    lines: [
      /size, technique, oracle/,
      /[Tt]he oracle's three/,
      /ORACLE_RULES/,
      /function oracleViolation\(oracle: string\)/,
      /oracle\.(includes|startsWith|endsWith)\(/,
      /an oracle never (contains|starts with|ends with)/,
      /const OracleSchema = oneLineText\("oracle"\)/,
      /\(oracle\) => oracleViolation\(oracle\)/,
      /oracle: OracleSchema/,
      /<oracle>/,
    ],
  },
  {
    id: "field-test-line-grammar",
    reason: "test line fourth field",
    file: "src/domain/plan/testLineGrammar.ts",
    lines: [/<oracle>/, /line\.oracle/, /oracleFields/, /oracle: oracleFields/],
  },
  {
    id: "field-plan-document",
    reason: "test line fourth field",
    file: "src/schemas/planDocument.ts",
    lines: [/<oracle>/],
  },
  {
    id: "field-extract-plan-prompt",
    reason: "test line fourth field",
    file: "src/app/extractPlan.ts",
    lines: [/<oracle>/],
  },
  {
    id: "field-help-text",
    reason: "test line fourth field",
    file: "src/cli/cliDocs.ts",
    lines: [/<oracle>/],
  },
  {
    id: "field-usage-contract",
    reason: "test line fourth field",
    file: "phax.usage.kdl",
    lines: [/<oracle>/],
  },
  {
    id: "field-cli-reference",
    reason: "test line fourth field",
    file: "docs/cli/reference.md",
    lines: [/<oracle>/],
  },

  {
    id: "field-json-schemas",
    reason: "test line fourth field",
    file: "packages/schemas/snapshots/*/*.schema.json",
    lines: [/^\s*"oracle",$/, /"oracle": \{/, /<oracle>/],
  },
  {
    id: "criterion-filter-json-schemas",
    reason: "old-name refusal",
    file: "packages/schemas/snapshots/*/*.schema.json",
    lines: [/'in-phase' nor 'oracle'/],
  },

  // ── The wrong-oracle escape of the code review.
  {
    id: "wrong-oracle-escape",
    reason: "wrong-oracle escape",
    file: "src/schemas/codeReview.ts",
    lines: [/"wrong-oracle"/],
  },
  {
    id: "wrong-oracle-escape-json-schema",
    reason: "wrong-oracle escape",
    file: "packages/schemas/snapshots/code-review/*.schema.json",
    lines: [/"wrong-oracle"/],
  },

  // ── Prose about what judges a test.
  {
    id: "render-plan-round-trip",
    reason: "prose about what judges a test",
    file: "src/domain/authoring/renderPlan.ts",
    lines: [/is the oracle/],
  },
];

/** One oracle or discharge word, located by its line and its column on it. */
export interface Occurrence {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly word: string;
  readonly text: string;
}

export const WORDS = /oracle|discharg/gi;

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split("**")
    .map((part) => part.split("*").map(escapeRegExp).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(REPO_ROOT, dir)).toSorted()) {
    const rel = `${dir}/${name}`;
    const stat = statSync(path.join(REPO_ROOT, rel));
    if (stat.isDirectory()) out.push(...listFiles(rel));
    else if (rel.endsWith(".ts")) out.push(rel);
  }
  return out;
}

function compareVersions(a: string, b: string): number {
  const [left, right] = [a, b].map((version) => version.split(".").map(Number));
  for (let i = 0; i < 3; i += 1) {
    const diff = (left![i] ?? 0) - (right![i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// The current shape of each format: `next` while one is pending, else the
// latest release. Older snapshots are frozen shapes of earlier releases.
function currentSchemaSnapshots(): string[] {
  return readdirSync(path.join(REPO_ROOT, SNAPSHOTS_DIR))
    .toSorted()
    .flatMap((format) => {
      const names = readdirSync(path.join(REPO_ROOT, SNAPSHOTS_DIR, format))
        .filter((name) => name.endsWith(".schema.json") && name !== "pre-schema.schema.json")
        .map((name) => name.slice(0, -".schema.json".length));
      const current = names.includes("next") ? "next" : names.toSorted(compareVersions).at(-1);
      return current === undefined ? [] : [`${SNAPSHOTS_DIR}/${format}/${current}.schema.json`];
    });
}

export function scannedFiles(): string[] {
  return [...SCANNED_ROOTS.flatMap(listFiles), ...SCANNED_FILES, ...currentSchemaSnapshots()];
}

export function findOccurrences(files: readonly string[]): Occurrence[] {
  const found: Occurrence[] = [];
  for (const file of files) {
    const lines = readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n");
    lines.forEach((text, index) => {
      for (const match of text.matchAll(WORDS)) {
        found.push({ file, line: index + 1, column: match.index, word: match[0], text });
      }
    });
  }
  return found;
}

// A pattern allows an occurrence only when one of its matches on that line
// spans the occurrence's word.
function spans(pattern: RegExp, occurrence: Occurrence): boolean {
  const start = occurrence.column;
  const end = start + occurrence.word.length;
  const global = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
  for (const match of occurrence.text.matchAll(global)) {
    if (match[0].length === 0) continue;
    if (match.index <= start && match.index + match[0].length >= end) return true;
  }
  return false;
}

function inFile(entry: AllowEntry, occurrence: Occurrence): boolean {
  return globToRegExp(entry.file).test(occurrence.file);
}

export function allows(entry: AllowEntry, occurrence: Occurrence): boolean {
  if (!inFile(entry, occurrence)) return false;
  return entry.lines === undefined || entry.lines.some((pattern) => spans(pattern, occurrence));
}

describe("acceptance words in the sources (ac-oracle-kept, source half)", () => {
  const files = scannedFiles();
  const occurrences = findOccurrences(files);

  it("scans the sources, the usage contract, the CLI reference and the JSON Schemas", () => {
    expect(files).toContain("src/cli/cliDocs.ts");
    expect(files).toContain("phax.schema.json");
    expect(files).toContain("packages/schemas/snapshots/plan-document/next.schema.json");
    expect(files).not.toContain("packages/schemas/snapshots/plan-document/0.32.0.schema.json");
    expect(files).toContain("packages/schemas/src/index.ts");
    expect(files).toContain("phax.usage.kdl");
    expect(files).toContain("docs/cli/reference.md");
  });

  it("finds no oracle or discharge outside an allowlist entry", () => {
    const unallowed = occurrences.filter((o) => !ALLOWLIST.some((entry) => allows(entry, o)));
    expect(
      unallowed.map((o) => `${o.file}:${String(o.line)}:${String(o.column + 1)}: ${o.text.trim()}`),
    ).toEqual([]);
  });

  it("has no allowlist entry or pattern that allows nothing", () => {
    const stale = ALLOWLIST.flatMap((entry) => {
      const inEntry = occurrences.filter((o) => inFile(entry, o));
      if (entry.lines === undefined) return inEntry.length === 0 ? [entry.id] : [];
      return entry.lines
        .filter((pattern) => !inEntry.some((o) => spans(pattern, o)))
        .map((pattern) => `${entry.id} ${String(pattern)}`);
    });
    expect(stale).toEqual([]);
  });

  it("holds whole-file entries only for frozen, reader and lift modules", () => {
    const wholeFile = ALLOWLIST.filter((entry) => entry.lines === undefined);
    for (const entry of wholeFile) {
      expect([
        "frozen shape of an earlier release",
        "reader or lift of an earlier shape",
        "retired oracle-request format id and exports",
      ]).toContain(entry.reason);
    }
  });

  it("allows only the word an entry's match spans, not the rest of its line", () => {
    const entry: AllowEntry = {
      id: "field",
      reason: "test line fourth field",
      file: "src/cli/cliDocs.ts",
      lines: [/<oracle>/],
    };
    const text = "write <oracle> after the technique; an oracle phase is discharged";
    const [field, phase, discharge] = [...text.matchAll(WORDS)].map(
      (match): Occurrence => ({
        file: "src/cli/cliDocs.ts",
        line: 1,
        column: match.index,
        word: match[0],
        text,
      }),
    );
    expect(allows(entry, field!)).toBe(true);
    expect(allows(entry, phase!)).toBe(false);
    expect(allows(entry, discharge!)).toBe(false);
  });

  it("gives every entry a unique id", () => {
    const ids = ALLOWLIST.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
