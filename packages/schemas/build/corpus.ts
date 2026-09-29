// Pure core of scripts/extract-history-corpus.ts: scrubs every document phax
// has written for a public repository, reads it with the package's own parse
// function, and lays it out as
// packages/schemas/corpus/<format id>/<shape>/<16-hex sha256 of the content>.json
// (spec §5.19). The shape directory is the shape the parse returns, never a
// guess from the document's `version` literal.
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import type { ParseFailure } from "../src/parsed.js";
import {
  parseAuthoringRecordManifest,
  parseComplianceReview,
  parseGateAttribution,
  parseGateDiagnostics,
  parseGatePending,
  parsePhaseFileReconciliation,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parsePlanApprovals,
  parsePlanDocument,
  parseRegistry,
  parseRunStatus,
  parseSpecApprovals,
  parseSpecDocument,
} from "../src/index.js";
import { sha256 } from "./generated.js";

/**
 * Every session-id field of every format, scrubbed at any depth. claudeSessionId
 * (phase status) is the only one today; sessionCostUsd is a cost and is kept.
 * corpusBuild.test.ts fails when a format gains a session-id field not listed here.
 */
export const SESSION_ID_FIELDS = ["claudeSessionId"] as const;

/** Shaped like the real values; the decoders only require a non-empty string. */
export const SESSION_ID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";

const SESSION_IDS: ReadonlySet<string> = new Set(SESSION_ID_FIELDS);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A deep copy of `value` for a public repository: every `home` followed by
 * `/` or ending the string, in any string value or object key, becomes `~`,
 * and every string value of a SESSION_ID_FIELDS key becomes the placeholder.
 * Everything else is kept, key order included. An empty `home` or `/`
 * scrubs no paths.
 */
export function scrubDocument(value: unknown, home: string): unknown {
  const root = home.replace(/\/+$/, "");
  const homePattern = root === "" ? undefined : new RegExp(`${escapeRegExp(root)}(?=/|$)`, "g");
  const scrubString = (text: string): string =>
    homePattern === undefined ? text : text.replace(homePattern, "~");
  const scrub = (node: unknown): unknown => {
    if (typeof node === "string") return scrubString(node);
    if (Array.isArray(node)) return node.map(scrub);
    if (typeof node === "object" && node !== null) {
      return Object.fromEntries(
        Object.entries(node).map(([key, child]) => [
          scrubString(key),
          SESSION_IDS.has(key) && typeof child === "string" ? SESSION_ID_PLACEHOLDER : scrub(child),
        ]),
      );
    }
    return node;
  };
  return scrub(value);
}

type CorpusParse = (input: unknown) => { readonly ok: true; readonly shape: string } | ParseFailure;

/** The package's parse function of every format; a new format id fails to compile until it has one. */
export const CORPUS_PARSERS: { readonly [F in FormatId]: CorpusParse } = {
  "phase-record-manifest": parsePhaseRecordManifest,
  "authoring-record-manifest": parseAuthoringRecordManifest,
  registry: parseRegistry,
  "run-status": parseRunStatus,
  "phase-status": parsePhaseStatus,
  "phax-plan": parsePhaxPlan,
  "compliance-review": parseComplianceReview,
  "plan-approvals": parsePlanApprovals,
  "spec-approvals": parseSpecApprovals,
  "spec-document": parseSpecDocument,
  "plan-document": parsePlanDocument,
  "gate-attribution": parseGateAttribution,
  "phase-file-reconciliation": parsePhaseFileReconciliation,
  "gate-diagnostics": parseGateDiagnostics,
  "gate-pending": parseGatePending,
};

/** A corpus file's bytes: the document as 2-space JSON with a trailing newline. */
export function corpusFileContent(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** `<format>/<shape>/<first 16 hex chars of sha256(content)>.json`, relative to the corpus. */
export function corpusPath(format: FormatId, shape: string, content: string): string {
  return `${format}/${shape}/${sha256(content).slice(0, 16)}.json`;
}

/** A document found in a source: its location-derived format, where it was found, its text. */
export interface CorpusSourceDocument {
  readonly format: FormatId;
  readonly source: string;
  readonly text: string;
}

export interface CorpusEntry {
  readonly path: string;
  readonly content: string;
}

export interface CorpusFailure {
  readonly source: string;
  readonly format: FormatId;
  readonly path: string;
  readonly message: string;
}

/**
 * The corpus the documents make: one entry per distinct scrubbed document,
 * sorted by path, and one failure per document that is not JSON or that its
 * format's parse rejects. The scrubbed value is what is parsed, so the
 * committed content is exactly what was verified.
 */
export function planCorpus(
  documents: ReadonlyArray<CorpusSourceDocument>,
  home: string,
): { entries: ReadonlyArray<CorpusEntry>; failures: ReadonlyArray<CorpusFailure> } {
  const entries = new Map<string, string>();
  const failures: CorpusFailure[] = [];
  for (const { format, source, text } of documents) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ source, format, path: "", message: `not JSON: ${message}` });
      continue;
    }
    const scrubbed = scrubDocument(value, home);
    const parsed = CORPUS_PARSERS[format](scrubbed);
    if (!parsed.ok) {
      failures.push({ source, format, ...parsed.error });
      continue;
    }
    const content = corpusFileContent(scrubbed);
    entries.set(corpusPath(format, parsed.shape, content), content);
  }
  return {
    entries: [...entries]
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, content]) => ({ path, content })),
    failures,
  };
}
