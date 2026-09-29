// Inventories every shape of phax's persisted formats that exists on disk and in git history,
// so a schemas-package plan starts from known shapes instead of discovering them while it runs.
// Deterministic: the same inputs give the same report. No document content is copied into the
// report — only key names, version literals, counts and the current decoder's verdict.
//
// Run with:
//   pnpm exec tsx scripts/survey-format-shapes.ts \
//     --phax-home ~/.phax --records ~/.phax/records/phax --records ../../steme/steme-lab \
//     --repo . --repo ../../steme/steme-lab --out docs/briefs/schemas-package-shapes
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
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

type Decoder = (
  input: unknown,
) => Either.Either<unknown, Parameters<typeof formatFirstViolation>[0]>;

const DECODERS: Record<string, Decoder> = {
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

interface Doc {
  readonly format: string;
  readonly source: string; // a short, home-relative locator
  readonly text: string;
}

// ── arguments
const args = process.argv.slice(2);
const many = (flag: string) =>
  args.flatMap((a, i) => (a === flag && args[i + 1] ? [args[i + 1] as string] : []));
const one = (flag: string) => many(flag)[0];
const HOME = homedir();
const expand = (p: string) => resolve(p.startsWith("~") ? join(HOME, p.slice(1)) : p);
const short = (p: string) => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
const out = one("--out");
if (!out) {
  console.error(
    "usage: tsx scripts/survey-format-shapes.ts --phax-home <dir> --records <repo>… --repo <repo>… --out <path-without-extension>",
  );
  process.exit(2);
}

// ── classification by location
function classifyRecordPath(path: string): string | null {
  const name = basename(path);
  if (name === "record.json")
    return path.startsWith("authoring/") ? "authoring-record-manifest" : "phase-record-manifest";
  if (name === "status.json") return "phase-status";
  if (name === "gate-attribution.json") return "gate-attribution";
  if (name === "file-reconciliation.json") return "phase-file-reconciliation";
  if (/^checks-attempt-\d+\.diagnostics\.json$/.test(name)) return "gate-diagnostics";
  if (/^checks-attempt-\d+\.pending\.json$/.test(name)) return "gate-pending";
  return null;
}
function classifyRepoPath(path: string): string | null {
  if (path === "docs/specs/approvals.json") return "spec-approvals";
  if (path === "docs/plans/approvals.json") return "plan-approvals";
  if (/^docs\/specs\/(archive\/)?[^/]+\.json$/.test(path)) return "spec-document";
  if (/^docs\/plans\/(archive\/)?[^/]+\.json$/.test(path)) return "plan-document";
  return null;
}
function classifyRunDirFile(rel: string): string | null {
  const name = basename(rel);
  if (rel === "run-status.json") return "run-status";
  if (rel === "phax-plan.json") return "phax-plan";
  if (rel === "compliance-review.json") return "compliance-review";
  if (/^phase-\d+\//.test(rel))
    return classifyRecordPath(name === "record.json" ? `x/${name}` : rel);
  return null;
}

// ── git sources: every distinct blob a path ever held
function git(repo: string, gitArgs: string[], input?: string): Buffer {
  return execFileSync("git", ["-C", repo, ...gitArgs], { input, maxBuffer: 1 << 30 });
}
function blobsAcrossHistory(repo: string, revs: string[], classify: (p: string) => string | null) {
  const seen = new Map<string, { format: string; path: string }>();
  const commits = git(repo, ["rev-list", ...revs])
    .toString()
    .split("\n")
    .filter(Boolean);
  for (const c of commits) {
    for (const line of git(repo, ["ls-tree", "-r", c]).toString().split("\n")) {
      const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
      if (!m) continue;
      const [, sha, path] = m as unknown as [string, string, string];
      const format = classify(path);
      if (format && !seen.has(sha)) seen.set(sha, { format, path });
    }
  }
  const shas = [...seen.keys()].toSorted();
  if (shas.length === 0) return [];
  const batch = git(repo, ["cat-file", "--batch"], shas.join("\n") + "\n");
  const docs: Doc[] = [];
  let at = 0;
  for (const sha of shas) {
    const nl = batch.indexOf(10, at);
    const size = Number(batch.subarray(at, nl).toString().split(" ")[2]);
    const text = batch.subarray(nl + 1, nl + 1 + size).toString();
    at = nl + 1 + size + 1;
    const meta = seen.get(sha)!;
    docs.push({ format: meta.format, source: `${short(repo)}@git:${meta.path}`, text });
  }
  return docs;
}

// ── phax home: run directories, live and archived, and the registry
function walkRunDirs(home: string): Doc[] {
  const docs: Doc[] = [];
  const reg = join(home, "registry.json");
  if (existsSync(reg))
    docs.push({ format: "registry", source: short(reg), text: readFileSync(reg, "utf8") });
  const runRoots = [join(home, "runs")];
  const archive = join(home, "archive");
  const runDirs: string[] = [];
  for (const root of runRoots)
    if (existsSync(root))
      for (const run of readdirSync(root).toSorted()) runDirs.push(join(root, run));
  // an archived run keeps its run directory as <archive>/<name>/runs itself
  if (existsSync(archive))
    for (const a of readdirSync(archive).toSorted()) runDirs.push(join(archive, a, "runs"));
  {
    for (const dir of runDirs) {
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue;
      const files: string[] = [];
      const walk = (rel: string) => {
        for (const e of readdirSync(join(dir, rel)).toSorted()) {
          const r = rel ? `${rel}/${e}` : e;
          if (statSync(join(dir, r)).isDirectory()) {
            if (/^phase-\d+$/.test(e)) walk(r);
          } else files.push(r);
        }
      };
      walk("");
      for (const rel of files) {
        const format = classifyRunDirFile(rel);
        if (format)
          docs.push({
            format,
            source: short(join(dir, rel)),
            text: readFileSync(join(dir, rel), "utf8"),
          });
      }
    }
  }
  return docs;
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
const docs: Doc[] = [];
const phaxHome = one("--phax-home");
if (phaxHome) docs.push(...walkRunDirs(expand(phaxHome)));
for (const r of many("--records")) {
  const repo = expand(r);
  const hasBranch = git(repo, ["branch", "-a", "--list", "*phax/records/v1"]).toString().trim();
  if (hasBranch)
    docs.push(
      ...blobsAcrossHistory(
        repo,
        [
          hasBranch.includes("remotes/") &&
          !hasBranch.split("\n").some((l) => !l.includes("remotes/"))
            ? "origin/phax/records/v1"
            : "phax/records/v1",
        ],
        classifyRecordPath,
      ),
    );
}
for (const r of many("--repo"))
  docs.push(
    ...blobsAcrossHistory(expand(r), ["--all", "--", "docs/specs", "docs/plans"], classifyRepoPath),
  );

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
  const decoded = DECODERS[d.format]!(value);
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
const sorted = Object.fromEntries(
  Object.keys(DECODERS).map((k) => [k, report[k] ?? { documents: 0, unparseable: 0, groups: [] }]),
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
      md.push(
        `- version ${g.version}, rejected: ${g.firstRejection!.replace(/\n/g, " ")} — e.g. \`${g.examples[0]}\``,
      );
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
