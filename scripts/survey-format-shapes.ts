// Inventories every shape of phax's persisted formats that exists on disk and in git history,
// so a schemas-package plan starts from known shapes instead of discovering them while it runs.
// Deterministic: the same inputs give the same report. No document content is copied into the
// report — only key names, version literals, counts and the current decoder's verdict.
// The sources are walked by scripts/formatSources.ts.
//
// Run with:
//   pnpm exec tsx scripts/survey-format-shapes.ts \
//     --phax-home ~/.phax --records ~/.phax/records/phax --records ../../steme/steme-lab \
//     --repo . --repo ../../steme/steme-lab --out docs/briefs/schemas-package-shapes
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { Either } from "effect";
import { decodeRegistry } from "../src/schemas/registry.js";
import { decodePhaseStatus, decodeRunStatus } from "../src/schemas/status.js";
import { decodePhaxPlan } from "../src/schemas/phaxPlan.js";
import { decodeComplianceReview } from "../src/schemas/complianceReview.js";
import { decodeApprovalRecordFile } from "../src/schemas/approvalRecord.js";
import { decodeSpecApprovalRecordFile } from "../src/schemas/specApprovalRecord.js";
import { decodeRunRecordManifest } from "../src/schemas/runRecord.js";
import { decodeAuthoringRecordManifest } from "../src/schemas/authoringRecord.js";
import { decodeSpecDocument } from "../src/schemas/specDocument.js";
import { decodePlanDocument } from "../src/schemas/planDocument.js";
import { decodeGateAttribution } from "../src/schemas/gateAttribution.js";
import { decodePhaseFileReconciliation } from "../src/schemas/reconciliation.js";
import { decodeGateDiagnosticsDocument } from "../src/schemas/gateDiagnostics.js";
import { decodeGatePendingDocument } from "../src/schemas/gatePending.js";
import { formatFirstViolation } from "../src/schemas/formatError.js";
import type { FormatId } from "../src/schemas/schemaUrl.js";
import {
  collectFormatDocuments,
  expandHome,
  shortenHome,
  type FormatSourceDocument,
} from "./formatSources.js";

type Decoder = (
  input: unknown,
) => Either.Either<unknown, Parameters<typeof formatFirstViolation>[0]>;

// keyed by every FormatId, so a format added later without a decoder fails to compile
const DECODERS: { readonly [F in FormatId]: Decoder } = {
  registry: decodeRegistry,
  "run-status": decodeRunStatus,
  "phase-status": decodePhaseStatus,
  "phax-plan": decodePhaxPlan,
  "compliance-review": decodeComplianceReview,
  "plan-approvals": decodeApprovalRecordFile,
  "spec-approvals": decodeSpecApprovalRecordFile,
  "phase-record-manifest": decodeRunRecordManifest,
  "authoring-record-manifest": decodeAuthoringRecordManifest,
  "spec-document": decodeSpecDocument,
  "plan-document": decodePlanDocument,
  "gate-attribution": decodeGateAttribution,
  "phase-file-reconciliation": decodePhaseFileReconciliation,
  "gate-diagnostics": decodeGateDiagnosticsDocument,
  "gate-pending": decodeGatePendingDocument,
};

type Doc = FormatSourceDocument;

// ── arguments
const args = process.argv.slice(2);
const many = (flag: string) =>
  args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1] as string] : []));
const one = (flag: string) => many(flag)[0];
const HOME = homedir();
const expand = (p: string) => expandHome(p, HOME);
const short = (p: string) => shortenHome(p, HOME);
const out = one("--out");
if (!out) {
  console.error(
    "usage: tsx scripts/survey-format-shapes.ts --phax-home <dir> --records <repo>… --repo <repo>… --out <path-without-extension>",
  );
  process.exit(2);
}

// ── shape signature: version literal, top-level keys, one level of nested keys
function signature(value: unknown): { version: string; keys: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { version: "n/a", keys: `<${Array.isArray(value) ? "array" : typeof value}>` };
  const o = value as Record<string, unknown>;
  const version = "$schema" in o ? "$schema" : "version" in o ? String(o.version) : "none";
  const parts = Object.keys(o)
    .toSorted()
    .map((k) => {
      const v = o[k];
      if (v && typeof v === "object" && !Array.isArray(v)) {
        const inner = Object.keys(v);
        // a table keyed by paths or run names: describe its values, not its keys
        if (inner.length && inner.every((kk) => /[/.]/.test(kk))) {
          const u = new Set<string>();
          for (const x of Object.values(v))
            if (x && typeof x === "object") for (const kk of Object.keys(x)) u.add(kk);
          return `${k}{*:{${[...u].toSorted().join(",")}}}`;
        }
        return `${k}{${inner.toSorted().join(",")}}`;
      }
      if (
        Array.isArray(v) &&
        v.length &&
        v.every((x) => x && typeof x === "object" && !Array.isArray(x))
      ) {
        const u = new Set<string>();
        for (const x of v) for (const kk of Object.keys(x as object)) u.add(kk);
        return `${k}[{${[...u].toSorted().join(",")}}]`;
      }
      return k;
    });
  return { version, keys: parts.join(" ") };
}

// ── collect
const phaxHome = one("--phax-home");
const docs: Doc[] = collectFormatDocuments({
  ...(phaxHome ? { phaxHome } : {}),
  records: many("--records"),
  repos: many("--repo"),
  home: HOME,
});

// dedupe identical documents per format
const unique = new Map<string, Doc>();
for (const d of docs) {
  const key = `${d.format}\0${createHash("sha256").update(d.text).digest("hex")}`;
  if (!unique.has(key)) unique.set(key, d);
}

// ── group
interface Group {
  version: string;
  keys: string;
  count: number;
  accepted: number;
  rejected: number;
  firstRejection: string | null;
  examples: string[];
}
const report: Record<string, { documents: number; unparseable: number; groups: Group[] }> = {};
for (const d of [...unique.values()].toSorted((a, b) =>
  (a.format + a.source).localeCompare(b.format + b.source),
)) {
  const f = (report[d.format] ??= { documents: 0, unparseable: 0, groups: [] });
  f.documents++;
  let value: unknown;
  try {
    value = JSON.parse(d.text);
  } catch {
    f.unparseable++;
    continue;
  }
  const sig = signature(value);
  let g = f.groups.find((x) => x.version === sig.version && x.keys === sig.keys);
  if (!g) {
    g = { ...sig, count: 0, accepted: 0, rejected: 0, firstRejection: null, examples: [] };
    f.groups.push(g);
  }
  g.count++;
  const decoded = DECODERS[d.format](value);
  if (Either.isRight(decoded)) g.accepted++;
  else {
    g.rejected++;
    g.firstRejection ??= formatFirstViolation(decoded.left).slice(0, 300);
  }
  if (g.examples.length < 2) g.examples.push(d.source);
}
for (const f of Object.values(report))
  f.groups.sort(
    (a, b) =>
      a.version.localeCompare(b.version) || b.count - a.count || a.keys.localeCompare(b.keys),
  );
// Example locators name runs and specs of other repositories (a phax home holds every
// repository's runs): they stay out of the committed report.
const publicGroups = (f: { documents: number; unparseable: number; groups: Group[] }) => ({
  ...f,
  groups: f.groups.map(({ examples: _examples, ...g }) => g),
});
const sorted = Object.fromEntries(
  Object.keys(DECODERS).map((k) => [
    k,
    publicGroups(report[k] ?? { documents: 0, unparseable: 0, groups: [] }),
  ]),
);

// ── write
writeFileSync(
  `${out}.json`,
  JSON.stringify(
    {
      inputs: {
        phaxHome: phaxHome ? short(expand(phaxHome)) : null,
        records: many("--records").map((p) => short(expand(p))),
        repos: many("--repo").map((p) => short(expand(p))),
      },
      formats: sorted,
    },
    null,
    2,
  ) + "\n",
);
const md: string[] = [
  "# Shapes of phax's persisted formats, as found",
  "",
  "Generated by `scripts/survey-format-shapes.ts`; do not edit. One row per (version literal, key signature).",
  "",
];
for (const [format, f] of Object.entries(sorted)) {
  md.push(
    `## ${format}`,
    "",
    `${f.documents} distinct documents${f.unparseable ? `, ${f.unparseable} not JSON` : ""}; ${f.groups.length} shape group(s).`,
    "",
  );
  if (!f.groups.length) {
    md.push("_None found._", "");
    continue;
  }
  md.push("| version | count | phax accepts | rejects | keys |", "|---|---|---|---|---|");
  for (const g of f.groups)
    md.push(`| ${g.version} | ${g.count} | ${g.accepted} | ${g.rejected} | \`${g.keys}\` |`);
  const rej = f.groups.filter((g) => g.firstRejection);
  if (rej.length) {
    md.push("");
    for (const g of rej)
      md.push(`- version ${g.version}, rejected: ${g.firstRejection!.replace(/\n/g, " ")}`);
  }
  md.push("");
}
writeFileSync(`${out}.md`, md.join("\n"));
console.log(
  Object.entries(sorted)
    .map(
      ([k, f]) =>
        `${k}: ${f.documents} docs, ${f.groups.length} groups, rejected ${f.groups.reduce((n, g) => n + g.rejected, 0)}`,
    )
    .join("\n"),
);
