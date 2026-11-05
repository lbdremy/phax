// The spec acceptance-tests' ac-oracle-kept scan: the words oracle and
// discharge may appear in the sources, the usage contract, the JSON Schemas, the
// README, the live docs, the site sources, the examples and the skills only where
// spec §5.21 keeps them. Plan 4 widened SCANNED_ROOTS and SCANNED_FILES below in
// three phases: the skills (phase-01), then the live docs and the site sources
// (phase-02), then the README, the docs page and the examples (phase-03).
// One line-based reader serves every file type: a word is an occurrence wherever
// it appears, code spans and fences included. docs/upgrading.md is read only
// through the end of its 0.33.0 entry (READ_THROUGH), as §8 leaves the entries of
// earlier releases out of scope.
//
// Reads files only: no phax process, no network, no HOME.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { snapshotPath } from "../../packages/schemas/build/snapshots.js";
import { CURRENT_SHAPES } from "../../packages/schemas/src/generated/index.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * A directory scanned recursively: files with one of `extensions` (every file
 * when `extensions` is "every file"), minus the excluded prefixes.
 */
export interface ScannedRoot {
  readonly dir: string;
  /** File suffixes read, with their dot: `.ts`, `.md`. */
  readonly extensions: readonly string[] | "every file";
  /** Repo-relative path prefixes (`docs/specs`) whose files and folders are skipped. */
  readonly exclude: readonly string[];
}

/**
 * Directories scanned recursively. The live docs leave out what records
 * decisions in the words of their day.
 */
export const SCANNED_ROOTS: readonly ScannedRoot[] = [
  { dir: "src", extensions: [".ts"], exclude: [] },
  { dir: "packages/schemas/src", extensions: [".ts"], exclude: [] },
  { dir: ".claude/skills", extensions: [".md"], exclude: [] },
  {
    dir: "docs",
    extensions: [".md"],
    exclude: ["docs/specs", "docs/plans", "docs/briefs", "docs/releases"],
  },
  {
    dir: "site",
    extensions: [".ts", ".tsx"],
    exclude: ["site/generated", "site/doc_build", "site/node_modules"],
  },
  // An example may be adapted to any runner, in any language: read them all.
  { dir: "examples", extensions: "every file", exclude: [] },
];
/** Single files scanned beside the roots. */
export const SCANNED_FILES: readonly string[] = [
  "README.md",
  "phax.usage.kdl",
  "phax.schema.json",
  "phax.user.schema.json",
];
/**
 * Files read only from their start through the end of the named section: the
 * heading's own section, up to the next heading of the same level.
 */
const READ_THROUGH: Readonly<Record<string, string>> = {
  "docs/upgrading.md": "### 0.33.0",
};
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
  | "prose about what judges a test"
  | "0.33.0 upgrading entry"
  | "archived spec slug oracle-phases";

export interface AllowEntry {
  readonly id: string;
  readonly reason: KeptCategory;
  /** A path glob relative to the repository root: `*` within a segment, `**` across segments. */
  readonly file: string;
  /**
   * A heading line (`### 0.33.0`) whose section the entry allows in full: from
   * that line to the next heading of the same level. Only with the "0.33.0
   * upgrading entry" reason, and never with `lines`.
   */
  readonly section?: string;
  /**
   * Absent for a whole-file entry (frozen modules and readers or lifts only)
   * and for a section entry.
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

  // ── The 0.33.0 upgrading entry names the old names it renames.
  {
    id: "upgrading-0-33-0",
    reason: "0.33.0 upgrading entry",
    file: "docs/upgrading.md",
    section: "### 0.33.0",
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
    lines: [/oracle-request/, /oracle request/],
  },
  {
    id: "schema-url-archived-spec-slug",
    reason: "archived spec slug oracle-phases",
    file: "src/schemas/schemaUrl.ts",
    lines: [/of spec oracle-phases/],
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
    id: "skip-oracle-definition",
    reason: "old-name refusal",
    file: "src/cli/definitions/resume.ts",
    lines: [/--skip-oracle/, /"skip-oracle"/, /SKIP_ORACLE_RETIRED/],
  },
  {
    id: "skip-oracle-upgrading-0-34-0",
    reason: "old-name refusal",
    file: "docs/upgrading.md",
    lines: [/`resume --skip-oracle` keeps its sentence/],
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
    file: "src/cli/definitions/artifactMigrations.ts",
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
    id: "field-planning-skill",
    reason: "test line fourth field",
    file: ".claude/skills/phax-planning/SKILL.md",
    lines: [
      /<oracle>/,
      /technique, oracle and loop/,
      /technique, oracle, loop, criterion/,
      /\*\*Oracle — what judges the result\.\*\*/,
      /whose oracle you/,
      /An oracle may hold/,
    ],
  },
  {
    id: "field-review-skill",
    reason: "test line fourth field",
    file: ".claude/skills/phax-review/SKILL.md",
    lines: [/technique, oracle,/, /<oracle>/],
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

  {
    id: "wrong-oracle-escape-review-skill",
    reason: "wrong-oracle escape",
    file: ".claude/skills/phax-review/SKILL.md",
    lines: [/wrong-oracle/],
  },

  // ── Prose about what judges a test.
  {
    id: "prose-review-skill",
    reason: "prose about what judges a test",
    file: ".claude/skills/phax-review/SKILL.md",
    lines: [/whose oracle is wrong/],
  },
  {
    id: "render-plan-round-trip",
    reason: "prose about what judges a test",
    file: "src/domain/authoring/renderPlan.ts",
    lines: [/is the oracle/],
  },
  {
    id: "prose-agentic-practices",
    reason: "prose about what judges a test",
    file: "docs/comparisons/agentic-practices.md",
    lines: [/The task verifier, or oracle/],
  },
  {
    id: "prose-idea-artifact-decide",
    reason: "prose about what judges a test",
    file: "docs/ideas/artifact-decide.md",
    lines: [/An oracle is independent of what it/],
  },
  {
    id: "prose-idea-change-gates",
    reason: "prose about what judges a test",
    file: "docs/ideas/change-gates-from-the-harness.md",
    lines: [/oracle-separation lint/, /a file and its oracle/],
  },
  {
    id: "prose-idea-headless-code-review",
    reason: "prose about what judges a test",
    file: "docs/ideas/headless-code-review.md",
    lines: [/oracle-separation lint/, /oracle separation/, /its oracle together/],
  },

  {
    id: "readme-retired-format-row",
    reason: "retired oracle-request format id and exports",
    file: "README.md",
    lines: [/Oracle request/, /oracle-request/],
  },
  {
    id: "readme-test-line-field",
    reason: "test line fourth field",
    file: "README.md",
    lines: [/<oracle>/],
  },
  {
    id: "docs-acceptance-phases-old-stem",
    reason: "reader or lift of an earlier shape",
    file: "docs/acceptance-phases.md",
    lines: [/\.oracle-request\.json/],
  },
  {
    id: "field-plan-overview",
    reason: "test line fourth field",
    file: "docs/plan-overview.md",
    lines: [/<oracle>/, /technique, oracle, loop, criterion/],
  },
  {
    id: "field-structured-answers",
    reason: "test line fourth field",
    file: "docs/structured-answers.md",
    lines: [/a test line's oracle must not/],
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

function listFiles(root: ScannedRoot, dir: string = root.dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(REPO_ROOT, dir)).toSorted()) {
    const rel = `${dir}/${name}`;
    if (root.exclude.some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
    const stat = statSync(path.join(REPO_ROOT, rel));
    if (stat.isDirectory()) out.push(...listFiles(root, rel));
    else if (
      root.extensions === "every file" ||
      root.extensions.some((extension) => rel.endsWith(extension))
    )
      out.push(rel);
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
  return [
    ...SCANNED_ROOTS.flatMap((root) => listFiles(root)),
    ...SCANNED_FILES,
    ...currentSchemaSnapshots(),
  ];
}

function readLines(file: string): string[] {
  return readFileSync(path.join(REPO_ROOT, file), "utf8").split("\n");
}

/**
 * The section a heading opens: its 1-based first line and its 1-based last line,
 * which is the line before the next heading of the same or a higher level.
 * Undefined when the file has no such heading.
 */
export function sectionBounds(
  lines: readonly string[],
  heading: string,
): { readonly start: number; readonly end: number } | undefined {
  const index = lines.indexOf(heading);
  if (index === -1) return undefined;
  const level = /^#+/.exec(heading)?.[0].length ?? 1;
  const next = new RegExp(`^#{1,${String(level)}} `);
  const after = lines.findIndex((text, i) => i > index && next.test(text));
  return { start: index + 1, end: after === -1 ? lines.length : after };
}

export function findOccurrences(files: readonly string[]): Occurrence[] {
  const found: Occurrence[] = [];
  for (const file of files) {
    const all = readLines(file);
    const through = READ_THROUGH[file];
    const bounds = through === undefined ? undefined : sectionBounds(all, through);
    if (through !== undefined && bounds === undefined) {
      throw new Error(`${file} has no "${through}" heading to read through`);
    }
    const lines = bounds === undefined ? all : all.slice(0, bounds.end);
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

function inSection(entry: AllowEntry, occurrence: Occurrence): boolean {
  if (entry.section === undefined) return false;
  const bounds = sectionBounds(readLines(occurrence.file), entry.section);
  return bounds !== undefined && occurrence.line >= bounds.start && occurrence.line <= bounds.end;
}

export function allows(entry: AllowEntry, occurrence: Occurrence): boolean {
  if (!inFile(entry, occurrence)) return false;
  if (entry.section !== undefined) return inSection(entry, occurrence);
  return entry.lines === undefined || entry.lines.some((pattern) => spans(pattern, occurrence));
}

describe("acceptance words in the sources (ac-oracle-kept, source half)", () => {
  const files = scannedFiles();
  const occurrences = findOccurrences(files);

  it("scans the sources, the usage contract, the JSON Schemas, the README, the live docs, the site sources, the examples and the skills", () => {
    expect(files).toContain("README.md");
    expect(files).toContain("docs/acceptance-phases.md");
    expect(files).toContain("examples/vitest-acceptance/main.mjs");
    expect(files).toContain("src/cli/cliDocs.ts");
    expect(files).toContain("phax.schema.json");
    // Only the current snapshot of a format: `next` while a release is
    // pending, the release's own stamp once it is cut.
    expect(files.filter((file) => file.startsWith(`${SNAPSHOTS_DIR}/plan-document/`))).toEqual([
      snapshotPath("plan-document", CURRENT_SHAPES["plan-document"]),
    ]);
    expect(files).toContain("packages/schemas/src/index.ts");
    expect(files).toContain("phax.usage.kdl");
    expect(files).toContain("docs/cli/reference.md");
    expect(files).toContain(".claude/skills/phax-planning/SKILL.md");
    expect(files).toContain(".claude/skills/phax-review/SKILL.md");
    expect(files).toContain("docs/upgrading.md");
    expect(files).toContain("docs/plan-overview.md");
    expect(files).toContain("docs/comparisons/agentic-practices.md");
    expect(files).toContain("site/pages.ts");
    expect(files).toContain("site/build/sources.ts");
    expect(files.filter((file) => /^docs\/(specs|plans|briefs|releases)\//.test(file))).toEqual([]);
    expect(files.filter((file) => file.startsWith("site/generated/"))).toEqual([]);
  });

  it("reads docs/upgrading.md only through its 0.33.0 entry", () => {
    const read = occurrences.filter((o) => o.file === "docs/upgrading.md");
    const lines = readLines("docs/upgrading.md");
    const bounds = sectionBounds(lines, "### 0.33.0");
    expect(bounds).toBeDefined();
    expect(read.length).toBeGreaterThan(0);
    expect(Math.max(...read.map((o) => o.line))).toBeLessThanOrEqual(bounds!.end);
    // The entries of 0.32.0 and before still name the words they shipped with.
    const earlier = new RegExp(WORDS.source, "i");
    expect(lines.slice(bounds!.end).some((text) => earlier.test(text))).toBe(true);
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
      if (entry.section !== undefined) {
        return inEntry.some((o) => allows(entry, o)) ? [] : [entry.id];
      }
      if (entry.lines === undefined) return inEntry.length === 0 ? [entry.id] : [];
      return entry.lines
        .filter((pattern) => !inEntry.some((o) => spans(pattern, o)))
        .map((pattern) => `${entry.id} ${String(pattern)}`);
    });
    expect(stale).toEqual([]);
  });

  it("holds whole-file entries only for frozen, reader and lift modules", () => {
    const wholeFile = ALLOWLIST.filter(
      (entry) => entry.lines === undefined && entry.section === undefined,
    );
    for (const entry of wholeFile) {
      expect([
        "frozen shape of an earlier release",
        "reader or lift of an earlier shape",
        "retired oracle-request format id and exports",
      ]).toContain(entry.reason);
    }
  });

  it("allows a section entry only with the 0.33.0 upgrading entry reason, and no line patterns", () => {
    const sections = ALLOWLIST.filter((entry) => entry.section !== undefined);
    expect(sections.map((entry) => entry.id)).toEqual(["upgrading-0-33-0"]);
    for (const entry of sections) {
      expect(entry.reason).toBe("0.33.0 upgrading entry");
      expect(entry.lines).toBeUndefined();
      expect(entry.section).toBe(READ_THROUGH[entry.file]);
    }
    for (const entry of ALLOWLIST.filter((e) => e.reason === "0.33.0 upgrading entry")) {
      expect(entry.section).toBeDefined();
    }
  });

  it("allows every word inside a section entry's section and none outside it", () => {
    const entry = ALLOWLIST.find((e) => e.id === "upgrading-0-33-0")!;
    const lines = readLines("docs/upgrading.md");
    const bounds = sectionBounds(lines, "### 0.33.0")!;
    const at = (line: number): Occurrence => ({
      file: "docs/upgrading.md",
      line,
      column: 0,
      word: "oracle",
      text: lines[line - 1]!,
    });
    expect(allows(entry, at(bounds.start))).toBe(true);
    expect(allows(entry, at(bounds.end))).toBe(true);
    expect(allows(entry, at(bounds.start - 1))).toBe(false);
    expect(allows(entry, at(bounds.end + 1))).toBe(false);
    expect(allows(entry, { ...at(bounds.start), file: "docs/plan-overview.md" })).toBe(false);
  });

  it("ends a section at the next heading of its level or above, and misses an absent heading", () => {
    const lines = ["# T", "### a", "x", "#### sub", "y", "### b", "z"];
    expect(sectionBounds(lines, "### a")).toEqual({ start: 2, end: 5 });
    expect(sectionBounds(lines, "### b")).toEqual({ start: 6, end: 7 });
    expect(sectionBounds(lines, "### c")).toBeUndefined();
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
