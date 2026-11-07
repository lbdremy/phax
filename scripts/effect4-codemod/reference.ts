// The vendored v3-to-v4 migration reference, read as data. Every entry keeps the 1-based
// line it sits on, so a rule or a report cites the line a reader checks it against.
//
// The file has four parts the codemod reads:
// - `## Import Map`: a fenced list of `<v3 module> -> <v4 module> (barrel: …)` lines;
// - `## No Counterpart Imports`: a fenced list of v4 modules with no v3 module;
// - `## Removed Modules`: `- `<v3 module>` -> `<v4 module>`: …` (or `- `<v3 module>`: …`);
// - `## API Reference`: under one `### `<module>`` heading per module, entries
//   `- `<Old>` -> `<New>`: …` (or `- `<Old>`: TODO …`) and `#### `<Old>`` headings
//   followed by a `**Replacement:** `<New>`` line.
//
// The reference is read from this repository, never from the tree being rewritten, and
// never fetched.
import { readFileSync } from "node:fs";

/** The repository-relative path of the vendored reference. */
export const REFERENCE_PATH = "docs/vendor/effect-migration/effect@4.1.2/migration/v3-to-v4.md";

/** The file name a report cites lines of. */
export const REFERENCE_NAME = "v3-to-v4.md";

/** Which part of the reference an entry was read from. */
export type ReferenceSection = "import-map" | "removed-modules" | "api";

/** One v3 symbol's entry: a module specifier (`effect/Either`) or a member (`Either.right`). */
export type ReferenceEntry = {
  readonly v3Symbol: string;
  /** 1-based line in the reference. */
  readonly line: number;
  readonly section: ReferenceSection;
  /** For an API entry, the module heading it sits under (`effect/Either`); else null. */
  readonly module: string | null;
  /** What the entry maps the symbol to (`none` included); null when it names no target
   *  (a TODO, "No single module replacement", or a heading with no replacement line). */
  readonly targets: ReadonlyArray<string> | null;
};

/** The parsed reference and its lookups. */
export type Reference = {
  readonly entries: ReadonlyArray<ReferenceEntry>;
  /** The v4 modules the reference lists as having no v3 counterpart. */
  readonly v4OnlyModules: ReadonlySet<string>;
  /** The names of the v3 `effect` modules (`Either`, `ParseResult`, …). */
  readonly effectModules: ReadonlySet<string>;
  /** The entry of a v3 symbol: a module specifier's (the Removed Modules entry first, then
   *  the Import Map line), or a member's under an `effect/…` module heading. */
  readonly entryOf: (v3Symbol: string) => ReferenceEntry | undefined;
  /** The line of a v3 symbol's entry, or null when it has none. */
  readonly lineOf: (v3Symbol: string) => number | null;
  /** The v3 symbols whose entry maps them to a different symbol, to `none`, or to no
   *  stated target: every symbol a migration has to touch. */
  readonly movedSymbols: ReadonlySet<string>;
};

const ENTRY = /^- `([^`]+)`(.*)$/;
const HEADING = /^#### `([^`]+)`\s*$/;
const MODULE_HEADING = /^### `([^`]+)`\s*$/;
const REPLACEMENT = /^\*\*Replacement:\*\* (.*)$/;
const IMPORT_MAP_LINE = /^(\S+) -> (\S+)(?: \(barrel: \S+\))?$/;
const NO_COUNTERPART_LINE = /^(\S+)(?: \(barrel: \S+\))?$/;

/** The backticked targets at the start of `text` (`` `A`, `B`: note `` gives A and B). */
function backtickedTargets(text: string): ReadonlyArray<string> {
  const targets: Array<string> = [];
  let rest = text;
  for (;;) {
    const match = /^`([^`]*)`/.exec(rest);
    if (match === null) break;
    targets.push(match[1] ?? "");
    rest = rest.slice(match[0].length);
    if (!rest.startsWith(", `")) break;
    rest = rest.slice(2);
  }
  return targets;
}

/** The targets an entry's text after its symbol names, or null when it names none. */
function entryTargets(rest: string): ReadonlyArray<string> | null {
  if (!rest.startsWith(" -> ")) return null;
  const after = rest.slice(4);
  const targets = backtickedTargets(after);
  if (targets.length > 0) return targets;
  const bare = /^([^:]+)/.exec(after);
  return bare === null ? null : [(bare[1] ?? "").trim()];
}

type Part = "preamble" | "import-map" | "no-counterpart" | "removed-modules" | "api";

function partOf(heading: string): Part {
  if (heading === "## Import Map") return "import-map";
  if (heading === "## No Counterpart Imports") return "no-counterpart";
  if (heading === "## Removed Modules") return "removed-modules";
  if (heading === "## API Reference") return "api";
  return "preamble";
}

function isMoved(entry: ReferenceEntry): boolean {
  const { targets } = entry;
  return targets === null || targets.length !== 1 || targets[0] !== entry.v3Symbol;
}

/** Reads the reference's text into entries and lookups. */
export function parseReference(text: string): Reference {
  const entries: Array<ReferenceEntry> = [];
  const v4OnlyModules = new Set<string>();
  const lines = text.split("\n");
  let part: Part = "preamble";
  let module: string | null = null;
  let inFence = false;
  /** The index in `entries` of a `####` heading still waiting for its replacement line. */
  let pendingHeading: number | null = null;

  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, "");
    const lineNumber = index + 1;
    if (line.startsWith("```")) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      if (part === "import-map") {
        const match = IMPORT_MAP_LINE.exec(line);
        if (match !== null) {
          entries.push({
            v3Symbol: match[1] ?? "",
            line: lineNumber,
            section: "import-map",
            module: null,
            targets: [match[2] ?? ""],
          });
        }
      } else if (part === "no-counterpart") {
        const match = NO_COUNTERPART_LINE.exec(line);
        if (match !== null) v4OnlyModules.add(match[1] ?? "");
      }
      return;
    }
    if (line.startsWith("## ")) {
      part = partOf(line);
      module = null;
      pendingHeading = null;
      return;
    }
    if (part === "removed-modules") {
      const match = ENTRY.exec(line);
      if (match !== null) {
        entries.push({
          v3Symbol: match[1] ?? "",
          line: lineNumber,
          section: "removed-modules",
          module: null,
          targets: entryTargets(match[2] ?? ""),
        });
      }
      return;
    }
    if (part !== "api") return;
    const moduleHeading = MODULE_HEADING.exec(line);
    if (moduleHeading !== null) {
      module = moduleHeading[1] ?? null;
      pendingHeading = null;
      return;
    }
    const heading = HEADING.exec(line);
    if (heading !== null) {
      pendingHeading = entries.length;
      entries.push({
        v3Symbol: heading[1] ?? "",
        line: lineNumber,
        section: "api",
        module,
        targets: null,
      });
      return;
    }
    const entry = ENTRY.exec(line);
    if (entry !== null) {
      pendingHeading = null;
      entries.push({
        v3Symbol: entry[1] ?? "",
        line: lineNumber,
        section: "api",
        module,
        targets: entryTargets(entry[2] ?? ""),
      });
      return;
    }
    const replacement = REPLACEMENT.exec(line);
    if (replacement !== null && pendingHeading !== null) {
      const headingEntry = entries[pendingHeading];
      const targets = backtickedTargets(replacement[1] ?? "");
      if (headingEntry !== undefined && targets.length > 0) {
        entries[pendingHeading] = { ...headingEntry, targets };
      }
      pendingHeading = null;
    }
  });

  return indexReference(entries, v4OnlyModules);
}

function indexReference(
  entries: ReadonlyArray<ReferenceEntry>,
  v4OnlyModules: ReadonlySet<string>,
): Reference {
  const removed = new Map<string, ReferenceEntry>();
  const importMap = new Map<string, ReferenceEntry>();
  const members = new Map<string, ReferenceEntry>();
  const effectModules = new Set<string>();
  for (const entry of entries) {
    if (entry.section === "api") {
      if (entry.module !== null && entry.module.startsWith("effect/")) {
        effectModules.add(entry.module.slice("effect/".length));
        if (!members.has(entry.v3Symbol)) members.set(entry.v3Symbol, entry);
      }
      continue;
    }
    const byModule = entry.section === "removed-modules" ? removed : importMap;
    if (!byModule.has(entry.v3Symbol)) byModule.set(entry.v3Symbol, entry);
    if (entry.v3Symbol.startsWith("effect/")) {
      const name = entry.v3Symbol.slice("effect/".length);
      if (!name.includes("/")) effectModules.add(name);
    }
  }
  // `effect/index` is the barrel itself, not a module the barrel exports.
  effectModules.delete("index");
  const entryOf = (v3Symbol: string): ReferenceEntry | undefined =>
    v3Symbol.includes("/")
      ? (removed.get(v3Symbol) ?? importMap.get(v3Symbol))
      : members.get(v3Symbol);
  const movedSymbols = new Set<string>();
  for (const symbol of [...removed.keys(), ...importMap.keys(), ...members.keys()]) {
    const entry = entryOf(symbol);
    if (entry !== undefined && isMoved(entry)) movedSymbols.add(symbol);
  }
  return {
    entries,
    v4OnlyModules,
    effectModules,
    entryOf,
    lineOf: (v3Symbol) => entryOf(v3Symbol)?.line ?? null,
    movedSymbols,
  };
}

let loaded: Reference | undefined;

/** The vendored reference of this repository, read once. */
export function loadReference(): Reference {
  if (loaded === undefined) {
    const url = new URL(`../../${REFERENCE_PATH}`, import.meta.url);
    loaded = parseReference(readFileSync(url, "utf8"));
  }
  return loaded;
}
