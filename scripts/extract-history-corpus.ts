// Extracts the history corpus (spec §5.19): every document phax has ever written, walked through
// scripts/formatSources.ts, scrubbed of home paths and session ids for a public repository, and
// classified by the shape the package's own parse returns. Writes
// packages/schemas/corpus/<format id>/<shape>/<16-hex content hash>.json, one file per distinct
// document.
//
// Additive: a file already in the corpus is never rewritten or deleted. All-or-nothing: when any
// document fails to parse, every failure is printed and nothing is written.
//
// pnpm exec tsx scripts/extract-history-corpus.ts --records ~/.phax/records/phax --repo . --phax-home ~/.phax --namespace phax
//
//   --records <repo>   a local clone of the records repository (repeatable)
//   --repo <repo>      a repository whose docs/specs and docs/plans history is read (repeatable)
//   --phax-home <dir>  a phax home: its registry and every live and archived run directory
//   --namespace <name> required with --phax-home: only this namespace's runs and registry entries
//   --out <dir>        the corpus directory (default: packages/schemas/corpus)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planCorpus, type CorpusFailure } from "../packages/schemas/build/corpus.js";
import { collectFormatDocuments, expandHome } from "./formatSources.js";

export interface HistoryCorpusSources {
  readonly records: ReadonlyArray<string>;
  readonly repos: ReadonlyArray<string>;
  readonly phaxHome?: string;
  /** Required with phaxHome: only this namespace's runs reach the corpus (see formatSources). */
  readonly namespace?: string;
  readonly home: string;
  readonly outDir: string;
}

export interface HistoryCorpusResult {
  readonly added: number;
  readonly kept: number;
  /** `<format>/<shape>` → its distinct documents and how many of them were added. */
  readonly perShape: ReadonlyMap<string, { total: number; added: number }>;
  readonly failures: ReadonlyArray<CorpusFailure>;
}

export function extractHistoryCorpus(sources: HistoryCorpusSources): HistoryCorpusResult {
  const { home, outDir } = sources;
  const documents = collectFormatDocuments({
    ...(sources.phaxHome === undefined ? {} : { phaxHome: sources.phaxHome }),
    ...(sources.namespace === undefined ? {} : { namespace: sources.namespace }),
    records: sources.records,
    repos: sources.repos,
    home,
  });
  const { entries, failures } = planCorpus(documents, home);
  if (failures.length > 0) return { added: 0, kept: 0, perShape: new Map(), failures };
  const perShape = new Map<string, { total: number; added: number }>();
  let added = 0;
  for (const { path, content } of entries) {
    const shape = path.split("/").slice(0, 2).join("/");
    const counts = perShape.get(shape) ?? { total: 0, added: 0 };
    counts.total += 1;
    const target = join(outDir, path);
    if (!existsSync(target)) {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, content);
      counts.added += 1;
      added += 1;
    }
    perShape.set(shape, counts);
  }
  return { added, kept: entries.length - added, perShape, failures };
}

const USAGE =
  "usage: extract-history-corpus.ts [--records <repo>]... [--repo <repo>]... [--phax-home <dir> --namespace <name>] [--out <dir>]";

function parseArgs(argv: ReadonlyArray<string>, home: string, repoRoot: string) {
  const records: string[] = [];
  const repos: string[] = [];
  let phaxHome: string | undefined;
  let namespace: string | undefined;
  let outDir = join(repoRoot, "packages/schemas/corpus");
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) return undefined;
    if (flag === "--records") records.push(expandHome(value, home));
    else if (flag === "--repo") repos.push(expandHome(value, home));
    else if (flag === "--phax-home") phaxHome = expandHome(value, home);
    else if (flag === "--namespace") namespace = value;
    else if (flag === "--out") outDir = expandHome(value, home);
    else return undefined;
  }
  if (records.length === 0 && repos.length === 0 && phaxHome === undefined) return undefined;
  // a phax home holds every repository's runs, private ones included: never read it unfiltered
  if (phaxHome !== undefined && namespace === undefined) return undefined;
  return {
    records,
    repos,
    ...(phaxHome === undefined ? {} : { phaxHome }),
    ...(namespace === undefined ? {} : { namespace }),
    outDir,
  };
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const repoRoot = join(fileURLToPath(import.meta.url), "../..");
  const home = homedir();
  const args = parseArgs(process.argv.slice(2), home, repoRoot);
  if (args === undefined) {
    console.error(USAGE);
    process.exit(2);
  }
  const result = extractHistoryCorpus({ ...args, home });
  if (result.failures.length > 0) {
    for (const { source, format, path, message } of result.failures) {
      console.error(`✗ ${source} (${format}): ${path}: ${message}`);
    }
    console.error(`${result.failures.length} document(s) failed to parse — nothing written`);
    process.exit(1);
  }
  for (const [shape, { total, added }] of result.perShape) {
    console.log(`${shape}: ${total} (${added} added)`);
  }
  console.log(`total: ${result.added + result.kept} (${result.added} added)`);
}
