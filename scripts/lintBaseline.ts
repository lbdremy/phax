// What the lint finds and what silences it, compared with what the operator accepted (lint-baseline.json).
// Pure: the command that runs oxlint, reads the directive comments and reads and writes the file is
// scripts/lint-baseline.ts.
//
// Two things are held. A disable directive (`oxlint-disable…`, `eslint-disable…`) stays in the code, next to
// what it excuses, and the baseline is the operator's permission for it: named by its file, the rule it
// silences and its kind (`line` for `-next-line` and `-line`, `file` for a whole-file `-disable`). A
// diagnostic oxlint reports (a rule, an unused directive) is held as accepted debt, kind `diagnostic`, named
// by its file and rule. Each is counted per file, never by line, which moves with every edit. The check
// fails when a count goes above what the baseline accepts, on an entry whose count is above what the code
// has (the baseline only shrinks: `--prune` lowers or drops such entries, the operator's to run), on an
// entry with no reason, and on a directive that names no rule.

export type DirectiveKind = "line" | "file";
export type EntryKind = DirectiveKind | "diagnostic";

const KINDS: readonly EntryKind[] = ["line", "file", "diagnostic"];

/** What one comment of the code silences, and why it says so. */
export interface Directive {
  readonly file: string;
  readonly line: number;
  readonly kind: DirectiveKind;
  readonly rules: readonly string[];
  /** The text after ` -- `; empty when the directive gives none. */
  readonly reason: string;
  /** The comment as written, for the failure text. */
  readonly text: string;
}

/** One diagnostic oxlint reports. */
export interface Diagnostic {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly message: string;
}

/** One place the baseline counts: a directive for one of its rules, or a diagnostic. */
export interface Occurrence {
  readonly kind: EntryKind;
  readonly file: string;
  readonly rule: string;
  readonly line: number;
  /** The comment or the diagnostic's message. */
  readonly text: string;
  /** For a directive: its own reason, empty when it gives none. */
  readonly reason?: string;
}

/** An accepted group: how many of a kind for a rule in a file, and why they stay. */
export interface BaselineEntry {
  readonly kind: EntryKind;
  readonly file: string;
  readonly rule: string;
  readonly count: number;
  readonly reason: string;
}

export interface Baseline {
  readonly entries: readonly BaselineEntry[];
}

/** A group with more occurrences than the baseline accepts (none, when it holds no entry). */
export interface Unaccepted {
  readonly kind: EntryKind;
  readonly file: string;
  readonly rule: string;
  readonly found: number;
  readonly accepted: number;
  readonly occurrences: readonly Occurrence[];
}

/** An entry that accepts more than the code has. */
export interface Stale {
  readonly entry: BaselineEntry;
  readonly found: number;
}

export interface Comparison {
  readonly unaccepted: readonly Unaccepted[];
  readonly stale: readonly Stale[];
  /** Entries whose reason is empty. */
  readonly unreasoned: readonly BaselineEntry[];
  /** Directives that name no rule, which no baseline holds. */
  readonly ruleless: readonly Directive[];
}

/** The reason of an entry the operator accepted as debt, to be paid by a clean-up. */
export const DEBT = "debt";

/** The reason of an entry in a module whose bytes packages/schemas/history.lock.json pins. */
export const FROZEN =
  "frozen: packages/schemas/history.lock.json pins this module's bytes, so its directives stay as they are " +
  "and their reason is written here";

/** The rule an unused disable directive is counted under. */
export const UNUSED_DIRECTIVE = "unused-disable-directive";

/** The rule of a diagnostic oxlint gives without a code. */
const NO_RULE = "(no rule)";

const DIRECTIVE =
  /^(?:oxlint|eslint)-(disable-next-line|disable-line|disable|enable)(?=\s|$)([\s\S]*)$/;

/**
 * Reads one comment's text (without its `//` or `/* *\/`). Returns undefined when it is not a disable
 * directive; an `-enable` silences nothing and is not one.
 */
export function parseDirective(
  value: string,
): Pick<Directive, "kind" | "rules" | "reason"> | undefined {
  const match = DIRECTIVE.exec(value.trim());
  if (match === null) return undefined;
  const [, keyword = "", rest = ""] = match;
  if (keyword === "enable") return undefined;
  const separator = /\s-{2,}(?:\s|$)/.exec(rest);
  const rulesPart = separator === null ? rest : rest.slice(0, separator.index);
  const reason = separator === null ? "" : rest.slice(separator.index + separator[0].length).trim();
  const rules = rulesPart
    .split(",")
    .map((rule) => rule.trim())
    .filter((rule) => rule !== "");
  return { kind: keyword === "disable" ? "file" : "line", rules, reason };
}

/** The directives among a file's comments; `start` is the comment's offset in `source`. */
export function directivesOf(
  file: string,
  source: string,
  comments: readonly { readonly value: string; readonly start: number; readonly end: number }[],
): Directive[] {
  const directives: Directive[] = [];
  for (const comment of comments) {
    const parsed = parseDirective(comment.value);
    if (parsed === undefined) continue;
    const line = source.slice(0, comment.start).split("\n").length;
    const text = source.slice(comment.start, comment.end).replace(/\s+/g, " ");
    directives.push({ file, line, text, ...parsed });
  }
  return directives;
}

interface OxlintDiagnostic {
  readonly message: string;
  readonly code?: string;
  readonly filename: string;
  readonly labels?: readonly { readonly span?: { readonly line?: number } }[];
}

/** oxlint's `--format json` document, as far as the check reads it. */
export interface OxlintReport {
  readonly diagnostics: readonly OxlintDiagnostic[];
  readonly number_of_files: number;
}

/** `typescript(no-explicit-any)` as `typescript/no-explicit-any`, `eslint(no-debugger)` as `no-debugger`. */
export function ruleOf(diagnostic: Pick<OxlintDiagnostic, "code" | "message">): string {
  if (diagnostic.code === undefined || diagnostic.code === "") {
    return /^Unused \S+ directive/.test(diagnostic.message) ? UNUSED_DIRECTIVE : NO_RULE;
  }
  const match = /^([\w@/-]+)\((.+)\)$/.exec(diagnostic.code);
  if (match === null) return diagnostic.code;
  const [, plugin = "", rule = ""] = match;
  return plugin === "eslint" ? rule : `${plugin}/${rule}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isDiagnostic = (value: unknown): value is OxlintDiagnostic =>
  isRecord(value) &&
  typeof value["message"] === "string" &&
  typeof value["filename"] === "string" &&
  (value["code"] === undefined || typeof value["code"] === "string") &&
  (value["labels"] === undefined || Array.isArray(value["labels"]));

/** Reads oxlint's `--format json` output; undefined when it is not one. */
export function parseReport(text: string): OxlintReport | undefined {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(document)) return undefined;
  const { diagnostics, number_of_files: files } = document;
  if (!Array.isArray(diagnostics) || typeof files !== "number") return undefined;
  const read = diagnostics.filter(isDiagnostic);
  if (read.length !== diagnostics.length) return undefined;
  return { diagnostics: read, number_of_files: files };
}

export function diagnosticsOf(report: OxlintReport): Diagnostic[] {
  return report.diagnostics.map((diagnostic) => ({
    file: diagnostic.filename,
    line: diagnostic.labels?.[0]?.span?.line ?? 0,
    rule: ruleOf(diagnostic),
    message: diagnostic.message,
  }));
}

/** Every place the baseline counts: a directive once per rule it names, every diagnostic. */
export function occurrencesOf(
  directives: readonly Directive[],
  diagnostics: readonly Diagnostic[],
): Occurrence[] {
  const occurrences: Occurrence[] = [];
  for (const directive of directives) {
    for (const rule of directive.rules) {
      occurrences.push({
        kind: directive.kind,
        file: directive.file,
        rule,
        line: directive.line,
        text: directive.text,
        reason: directive.reason,
      });
    }
  }
  for (const diagnostic of diagnostics) {
    occurrences.push({
      kind: "diagnostic",
      file: diagnostic.file,
      rule: diagnostic.rule,
      line: diagnostic.line,
      text: diagnostic.message,
    });
  }
  return occurrences;
}

type Identity = Pick<BaselineEntry, "kind" | "file" | "rule">;

const keyOf = (item: Identity): string => `${item.kind}\u0000${item.file}\u0000${item.rule}`;

const byPlace = (a: Identity, b: Identity): number =>
  a.file.localeCompare(b.file) ||
  KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) ||
  a.rule.localeCompare(b.rule);

function grouped(occurrences: readonly Occurrence[]): Map<string, Occurrence[]> {
  const groups = new Map<string, Occurrence[]>();
  for (const occurrence of occurrences) {
    const key = keyOf(occurrence);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [occurrence]);
    else group.push(occurrence);
  }
  return groups;
}

export function compare(
  directives: readonly Directive[],
  diagnostics: readonly Diagnostic[],
  baseline: Baseline,
): Comparison {
  const groups = grouped(occurrencesOf(directives, diagnostics));
  const accepted = new Map(baseline.entries.map((entry) => [keyOf(entry), entry]));
  const unaccepted: Unaccepted[] = [];
  for (const occurrences of groups.values()) {
    const [first] = occurrences;
    if (first === undefined) continue;
    const count = accepted.get(keyOf(first))?.count ?? 0;
    if (occurrences.length > count) {
      unaccepted.push({
        kind: first.kind,
        file: first.file,
        rule: first.rule,
        found: occurrences.length,
        accepted: count,
        occurrences: occurrences.toSorted((a, b) => a.line - b.line),
      });
    }
  }
  const stale: Stale[] = [];
  for (const entry of baseline.entries) {
    const found = groups.get(keyOf(entry))?.length ?? 0;
    if (found < entry.count) stale.push({ entry, found });
  }
  return {
    unaccepted: unaccepted.toSorted(byPlace),
    stale: stale.toSorted((a, b) => byPlace(a.entry, b.entry)),
    unreasoned: baseline.entries.filter((entry) => entry.reason.trim() === "").toSorted(byPlace),
    ruleless: directives.filter((directive) => directive.rules.length === 0),
  };
}

export const passes = (comparison: Comparison): boolean =>
  comparison.unaccepted.length === 0 &&
  comparison.stale.length === 0 &&
  comparison.unreasoned.length === 0 &&
  comparison.ruleless.length === 0;

/** The baseline with each count lowered to what the code has, and the entries at zero dropped. It never
 * gains an entry and never raises a count. */
export function prune(
  baseline: Baseline,
  directives: readonly Directive[],
  diagnostics: readonly Diagnostic[],
): Baseline {
  const groups = grouped(occurrencesOf(directives, diagnostics));
  const entries: BaselineEntry[] = [];
  for (const entry of baseline.entries) {
    const count = Math.min(entry.count, groups.get(keyOf(entry))?.length ?? 0);
    if (count > 0) entries.push({ ...entry, count });
  }
  return { entries };
}

/** The first baseline: every directive and diagnostic of today. A directive's reason is its own when it
 * gives one, else `debt`; anything in a frozen module carries {@link FROZEN}. */
export function initialBaseline(
  directives: readonly Directive[],
  diagnostics: readonly Diagnostic[],
  frozen: ReadonlySet<string>,
): Baseline {
  const entries: BaselineEntry[] = [];
  for (const occurrences of grouped(occurrencesOf(directives, diagnostics)).values()) {
    const [first] = occurrences;
    if (first === undefined) continue;
    const given = [...new Set(occurrences.map((occurrence) => occurrence.reason ?? ""))].filter(
      (reason) => reason !== "",
    );
    const reason = frozen.has(first.file) ? FROZEN : given.length > 0 ? given.join("; ") : DEBT;
    entries.push({
      kind: first.kind,
      file: first.file,
      rule: first.rule,
      count: occurrences.length,
      reason,
    });
  }
  return { entries: entries.toSorted(byPlace) };
}

export const BASELINE_COMMENT =
  "The lint's exceptions the operator accepted, each with its reason; `debt` is paid by a clean-up. " +
  "`line` and `file` count the disable directives the code keeps for a rule in a file, `diagnostic` what " +
  "oxlint reports there. scripts/lint-baseline.ts fails on anything above these counts and on an entry above " +
  "what the code has; `pnpm lint --prune` lowers the latter. A protected path: a run never adds to it.";

export function renderBaseline(baseline: Baseline): string {
  const entries = baseline.entries
    .toSorted(byPlace)
    .map(({ kind, file, rule, count, reason }) => ({ kind, file, rule, count, reason }));
  return `${JSON.stringify({ $comment: BASELINE_COMMENT, entries }, null, 2)}\n`;
}

/** Reads the file's text; throws with what is wrong. */
export function parseBaseline(text: string): Baseline {
  const document: unknown = JSON.parse(text);
  if (typeof document !== "object" || document === null || !("entries" in document)) {
    throw new Error("lint-baseline.json: expected an object with `entries`");
  }
  const { entries } = document;
  if (!Array.isArray(entries)) throw new Error("lint-baseline.json: `entries` must be an array");
  const seen = new Set<string>();
  return {
    entries: entries.map((entry: unknown, index): BaselineEntry => {
      const record = isRecord(entry) ? entry : {};
      const field = (name: string): string => {
        const value = record[name];
        if (typeof value !== "string") {
          throw new Error(`lint-baseline.json: entry ${index} has no string \`${name}\``);
        }
        return value;
      };
      const kind = KINDS.find((known) => known === record["kind"]);
      if (kind === undefined) {
        throw new Error(
          `lint-baseline.json: entry ${index} has a \`kind\` other than ${KINDS.join(", ")}`,
        );
      }
      const count = record["count"];
      if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
        throw new Error(`lint-baseline.json: entry ${index} has no positive integer \`count\``);
      }
      const parsed = {
        kind,
        file: field("file"),
        rule: field("rule"),
        count,
        reason: field("reason"),
      };
      if (seen.has(keyOf(parsed))) {
        throw new Error(
          `lint-baseline.json: entry ${index} repeats ${parsed.kind} ${parsed.file} ${parsed.rule}`,
        );
      }
      seen.add(keyOf(parsed));
      return parsed;
    }),
  };
}

const groupLine = (item: Identity, counts: string): string =>
  `  ${item.kind}  ${item.file}  ${item.rule}  (${counts})`;

const occurrenceLine = (occurrence: Occurrence): string =>
  `    ${occurrence.file}:${occurrence.line}  ${occurrence.text}` +
  (occurrence.reason === "" ? "  [gives no reason]" : "");

/** What the check prints when it fails; empty when it passes. */
export function renderFailure(comparison: Comparison): string {
  const parts: string[] = [];
  const directives = comparison.unaccepted.filter((group) => group.kind !== "diagnostic");
  const diagnostics = comparison.unaccepted.filter((group) => group.kind === "diagnostic");
  if (diagnostics.length > 0) {
    parts.push(
      `lint: ${diagnostics.length} rule(s) in a file report more than lint-baseline.json accepts:`,
    );
    for (const group of diagnostics) {
      parts.push(
        groupLine(group, `${group.found} found, ${group.accepted} accepted`),
        ...group.occurrences.map(occurrenceLine),
      );
    }
    if (diagnostics.some((group) => group.rule === UNUSED_DIRECTIVE)) {
      parts.push(`${UNUSED_DIRECTIVE}: the directive silences nothing; remove it.`);
    }
    parts.push(
      "Fix the code. lint-baseline.json is the operator's, a protected path: a run never adds to it.",
    );
  }
  if (directives.length > 0) {
    parts.push(
      `lint: ${directives.length} rule(s) in a file are silenced by more directives than lint-baseline.json accepts:`,
    );
    for (const group of directives) {
      parts.push(
        groupLine(group, `${group.found} found, ${group.accepted} accepted`),
        ...group.occurrences.map(occurrenceLine),
      );
    }
    parts.push(
      "A lint error is fixed in the code, not silenced: remove the directive and fix what it hides. " +
        "A new directive, with its reason after ` -- `, needs the operator's entry in lint-baseline.json, " +
        "a protected path.",
    );
  }
  if (comparison.ruleless.length > 0) {
    parts.push(
      `lint: ${comparison.ruleless.length} directive(s) silence every rule; a directive names the rules it silences:`,
      ...comparison.ruleless.map(
        (directive) => `    ${directive.file}:${directive.line}  ${directive.text}`,
      ),
    );
  }
  if (comparison.stale.length > 0) {
    parts.push(
      `lint: ${comparison.stale.length} entry(ies) of lint-baseline.json accept more than the code has:`,
      ...comparison.stale.map(({ entry, found }) =>
        groupLine(entry, `${entry.count} accepted, ${found} found`),
      ),
      "The baseline only shrinks: the operator runs `pnpm lint --prune` to lower or drop them.",
    );
  }
  if (comparison.unreasoned.length > 0) {
    parts.push(
      `lint: ${comparison.unreasoned.length} entry(ies) of lint-baseline.json give no reason:`,
      ...comparison.unreasoned.map((entry) => groupLine(entry, `${entry.count}`)),
    );
  }
  return parts.join("\n");
}
