// What knip finds, compared with the findings the operator accepted (knip-baseline.json). Pure: the
// command that runs knip and reads and writes the file is scripts/knip-baseline.ts.
//
// A finding is named by its issue type, its file and its symbol, never its line, which moves with every
// edit. The check fails on a finding the baseline does not hold, on an entry no finding matches any more
// (the baseline only shrinks: `--prune` drops such entries, the operator's to run), on an entry with no
// reason, and on any configuration hint knip gives.

/** One finding, as scripts/knip-reporter.ts prints it. */
export interface KnipFinding {
  readonly type: string;
  readonly file: string;
  readonly name: string;
}

/** What scripts/knip-reporter.ts prints for one knip run. */
export interface KnipReport {
  readonly findings: readonly KnipFinding[];
  readonly hints: readonly { readonly type: string; readonly identifier: string }[];
}

/** An accepted finding: what it is, and why it stays. */
export interface BaselineEntry extends KnipFinding {
  readonly reason: string;
}

export interface Baseline {
  readonly entries: readonly BaselineEntry[];
}

export interface Comparison {
  /** Findings the baseline does not hold. */
  readonly unaccepted: readonly KnipFinding[];
  /** Entries no finding matches any more. */
  readonly stale: readonly BaselineEntry[];
  /** Entries whose reason is empty. */
  readonly unreasoned: readonly BaselineEntry[];
  readonly hints: KnipReport["hints"];
}

/** The reason of an entry the operator accepted as debt, to be paid by a clean-up. */
export const DEBT = "debt";

const keyOf = (finding: KnipFinding): string =>
  `${finding.type}\u0000${finding.file}\u0000${finding.name}`;

// By code point, not by locale, so the file is written in the same order on every machine.
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const byPlace = (a: KnipFinding, b: KnipFinding): number =>
  byCodePoint(a.file, b.file) || byCodePoint(a.type, b.type) || byCodePoint(a.name, b.name);

/** The findings of several runs (the default one and the production one), each finding once. */
export function mergeReports(reports: readonly KnipReport[]): KnipReport {
  const findings = new Map<string, KnipFinding>();
  const hints = new Map<string, KnipReport["hints"][number]>();
  for (const report of reports) {
    for (const finding of report.findings) findings.set(keyOf(finding), finding);
    for (const hint of report.hints) hints.set(`${hint.type}\u0000${hint.identifier}`, hint);
  }
  return { findings: [...findings.values()].toSorted(byPlace), hints: [...hints.values()] };
}

export function compare(report: KnipReport, baseline: Baseline): Comparison {
  const found = new Set(report.findings.map(keyOf));
  const accepted = new Set(baseline.entries.map(keyOf));
  return {
    unaccepted: report.findings
      .filter((finding) => !accepted.has(keyOf(finding)))
      .toSorted(byPlace),
    stale: baseline.entries.filter((entry) => !found.has(keyOf(entry))).toSorted(byPlace),
    unreasoned: baseline.entries.filter((entry) => entry.reason.trim() === "").toSorted(byPlace),
    hints: report.hints,
  };
}

export const passes = (comparison: Comparison): boolean =>
  comparison.unaccepted.length === 0 &&
  comparison.stale.length === 0 &&
  comparison.unreasoned.length === 0 &&
  comparison.hints.length === 0;

/** The baseline without its stale entries. It never gains one. */
export function prune(baseline: Baseline, report: KnipReport): Baseline {
  const found = new Set(report.findings.map(keyOf));
  return { entries: baseline.entries.filter((entry) => found.has(keyOf(entry))) };
}

/** The first baseline: every finding of today, accepted as debt. */
export function initialBaseline(report: KnipReport): Baseline {
  return {
    entries: report.findings.toSorted(byPlace).map((finding) => ({ ...finding, reason: DEBT })),
  };
}

export const BASELINE_COMMENT =
  "Findings of knip the operator accepted, each with its reason; `debt` is paid by a clean-up. " +
  "scripts/knip-baseline.ts fails on a finding outside this file and on an entry nothing matches; " +
  "`pnpm knip --prune` drops the latter. A protected path: a run never adds to it.";

export function renderBaseline(baseline: Baseline): string {
  const entries = baseline.entries
    .toSorted(byPlace)
    .map(({ type, file, name, reason }) => ({ type, file, name, reason }));
  return `${JSON.stringify({ $comment: BASELINE_COMMENT, entries }, null, 2)}\n`;
}

/** Reads the file's text; throws with what is wrong (an entry missing a field, an entry written twice). */
export function parseBaseline(text: string): Baseline {
  const document: unknown = JSON.parse(text);
  if (typeof document !== "object" || document === null || !("entries" in document)) {
    throw new Error("knip-baseline.json: expected an object with `entries`");
  }
  const { entries } = document;
  if (!Array.isArray(entries)) throw new Error("knip-baseline.json: `entries` must be an array");
  const seen = new Set<string>();
  return {
    entries: entries.map((entry: unknown, index): BaselineEntry => {
      const field = (name: string): string => {
        const value =
          typeof entry === "object" && entry !== null
            ? (entry as Record<string, unknown>)[name]
            : undefined;
        if (typeof value !== "string") {
          throw new Error(`knip-baseline.json: entry ${index} has no string \`${name}\``);
        }
        return value;
      };
      const parsed = {
        type: field("type"),
        file: field("file"),
        name: field("name"),
        reason: field("reason"),
      };
      if (seen.has(keyOf(parsed))) {
        throw new Error(
          `knip-baseline.json: entry ${index} repeats ${parsed.type} ${parsed.file} ${parsed.name}`,
        );
      }
      seen.add(keyOf(parsed));
      return parsed;
    }),
  };
}

const line = (finding: KnipFinding): string =>
  `  ${finding.type}  ${finding.file}  ${finding.name}`;

/** What the check prints when it fails; empty when it passes. */
export function renderFailure(comparison: Comparison): string {
  const parts: string[] = [];
  if (comparison.unaccepted.length > 0) {
    parts.push(
      `knip: ${comparison.unaccepted.length} finding(s) outside knip-baseline.json:`,
      ...comparison.unaccepted.map(line),
      "Fix the code: remove what nothing uses, or wire it into what runs. The baseline is the operator's.",
    );
  }
  if (comparison.stale.length > 0) {
    parts.push(
      `knip: ${comparison.stale.length} entry(ies) of knip-baseline.json match nothing any more:`,
      ...comparison.stale.map(line),
      "The operator runs `pnpm knip --prune` to drop them.",
    );
  }
  if (comparison.unreasoned.length > 0) {
    parts.push(
      `knip: ${comparison.unreasoned.length} entry(ies) of knip-baseline.json give no reason:`,
      ...comparison.unreasoned.map(line),
    );
  }
  if (comparison.hints.length > 0) {
    parts.push(
      `knip: ${comparison.hints.length} configuration hint(s), fixed in knip.json:`,
      ...comparison.hints.map((hint) => `  ${hint.type}  ${hint.identifier}`),
    );
  }
  return parts.join("\n");
}
