// The walk over every source of phax's persisted documents: every commit of a records branch,
// a repository's history of the approvals ledgers and the spec and plan sidecars, and every live
// and archived run directory plus the registry of a phax home. Each document found is classified
// by its location into a format id — the only identification a legacy document allows.
//
// Shared by scripts/survey-format-shapes.ts and scripts/extract-history-corpus.ts so both read
// exactly the same sources. No side effects at import: callers pass every path, and the home
// directory used to shorten sources, explicitly.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { FormatId } from "../src/schemas/schemaUrl.js";

export interface FormatSourceDocument {
  readonly format: FormatId;
  readonly source: string; // a short, home-relative locator
  readonly text: string;
}

export interface FormatSources {
  readonly phaxHome?: string;
  readonly records: ReadonlyArray<string>;
  readonly repos: ReadonlyArray<string>;
  readonly home: string;
}

export const expandHome = (path: string, home: string): string =>
  resolve(path.startsWith("~") ? join(home, path.slice(1)) : path);
export const shortenHome = (path: string, home: string): string =>
  path.startsWith(home) ? `~${path.slice(home.length)}` : path;

// ── classification by location
export function classifyRecordPath(path: string): FormatId | null {
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
export function classifyRepoPath(path: string): FormatId | null {
  if (path === "docs/specs/approvals.json") return "spec-approvals";
  if (path === "docs/plans/approvals.json") return "plan-approvals";
  if (/^docs\/specs\/(archive\/)?[^/]+\.json$/.test(path)) return "spec-document";
  if (/^docs\/plans\/(archive\/)?[^/]+\.json$/.test(path)) return "plan-document";
  return null;
}
export function classifyRunDirFile(rel: string): FormatId | null {
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
function blobsAcrossHistory(
  repo: string,
  revs: string[],
  classify: (p: string) => FormatId | null,
  home: string,
): FormatSourceDocument[] {
  const seen = new Map<string, { format: FormatId; path: string }>();
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
  const docs: FormatSourceDocument[] = [];
  let at = 0;
  for (const sha of shas) {
    const nl = batch.indexOf(10, at);
    const size = Number(batch.subarray(at, nl).toString().split(" ")[2]);
    const text = batch.subarray(nl + 1, nl + 1 + size).toString();
    at = nl + 1 + size + 1;
    const meta = seen.get(sha)!;
    docs.push({
      format: meta.format,
      source: `${shortenHome(repo, home)}@git:${meta.path}`,
      text,
    });
  }
  return docs;
}

// The records branch: the local one, or origin's when only the remote-tracking branch exists.
// Null when the repository has neither.
function recordsBranch(repo: string): string | null {
  const hasBranch = git(repo, ["branch", "-a", "--list", "*phax/records/v1"]).toString().trim();
  if (!hasBranch) return null;
  return hasBranch.includes("remotes/") &&
    !hasBranch.split("\n").some((l) => !l.includes("remotes/"))
    ? "origin/phax/records/v1"
    : "phax/records/v1";
}

// ── phax home: run directories, live and archived, and the registry
function walkRunDirs(phaxHome: string, home: string): FormatSourceDocument[] {
  const docs: FormatSourceDocument[] = [];
  const reg = join(phaxHome, "registry.json");
  if (existsSync(reg))
    docs.push({
      format: "registry",
      source: shortenHome(reg, home),
      text: readFileSync(reg, "utf8"),
    });
  const runRoots = [join(phaxHome, "runs")];
  const archive = join(phaxHome, "archive");
  const runDirs: string[] = [];
  for (const root of runRoots)
    if (existsSync(root))
      for (const run of readdirSync(root).toSorted()) runDirs.push(join(root, run));
  // an archived run keeps its run directory as <archive>/<name>/runs itself
  if (existsSync(archive))
    for (const a of readdirSync(archive).toSorted()) runDirs.push(join(archive, a, "runs"));
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
          source: shortenHome(join(dir, rel), home),
          text: readFileSync(join(dir, rel), "utf8"),
        });
    }
  }
  return docs;
}

/**
 * Every document found in the given sources, in source order: the phax home, then each records
 * repository, then each repository. Git blobs are deduplicated within one source; content dedupe
 * across sources is left to the caller. Paths may start with `~`, expanded against `home`.
 */
export function collectFormatDocuments(sources: FormatSources): FormatSourceDocument[] {
  const { home } = sources;
  const docs: FormatSourceDocument[] = [];
  if (sources.phaxHome) docs.push(...walkRunDirs(expandHome(sources.phaxHome, home), home));
  for (const r of sources.records) {
    const repo = expandHome(r, home);
    const branch = recordsBranch(repo);
    if (branch) docs.push(...blobsAcrossHistory(repo, [branch], classifyRecordPath, home));
  }
  for (const r of sources.repos)
    docs.push(
      ...blobsAcrossHistory(
        expandHome(r, home),
        ["--all", "--", "docs/specs", "docs/plans"],
        classifyRepoPath,
        home,
      ),
    );
  return docs;
}
