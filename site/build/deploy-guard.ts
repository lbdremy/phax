// The deploy guard: the release and docs-deploy workflows run it before any
// upload. A deploy must never remove a schema URL docs.phax.run serves, so it
// reads the live schema index and refuses a build that lacks any listed path.
//   404                          first deploy: passes
//   200 with a { releases, paths } index
//                                passes only if the build serves every path
//   any other status, a network error or a malformed body
//                                refuses (strict over loose)
// It reads no credential and uploads nothing. Exits 1 on refusal.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSchemaIndex, type SchemaIndex } from "./schemas.js";

export const LIVE_INDEX_URL = "https://docs.phax.run/schemas/index.json";
export const BUILD_DIR = resolve(import.meta.dirname, "../doc_build");

const FETCH_TIMEOUT_MS = 30_000;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export type GuardResult =
  | { readonly pass: true; readonly reason: string }
  | { readonly pass: false; readonly finding: string };

/**
 * The finding naming the first path `live` lists that the build does not
 * serve, or undefined when the build serves every one of them.
 */
export function guardServedSchemas(
  live: SchemaIndex,
  builtPaths: ReadonlySet<string>,
): string | undefined {
  const missing = live.paths.find((path) => !builtPaths.has(path));
  return missing === undefined
    ? undefined
    : `✗ deploy guard: this build does not serve ${missing}, which docs.phax.run serves`;
}

/** A served path: `/schemas/…` with no empty, `.` or `..` segment. */
function isServedPath(path: string): boolean {
  const segments = path.split("/").slice(1);
  return (
    path.startsWith("/schemas/") &&
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..")
  );
}

/** Fetches the live index at `indexUrl` and checks the build in `buildDir` against it. */
export async function runGuard(options: {
  readonly fetch: Fetch;
  readonly indexUrl?: string;
  readonly buildDir?: string;
}): Promise<GuardResult> {
  const indexUrl = options.indexUrl ?? LIVE_INDEX_URL;
  const buildDir = options.buildDir ?? BUILD_DIR;
  let response: Response;
  let body: string;
  try {
    response = await options.fetch(indexUrl, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { pass: false, finding: `✗ deploy guard: could not fetch ${indexUrl}: ${reason}` };
  }
  if (response.status === 404) {
    return { pass: true, reason: `${indexUrl} answers 404: first deploy` };
  }
  if (response.status !== 200) {
    return {
      pass: false,
      finding: `✗ deploy guard: ${indexUrl} answered ${response.status}; expected 200 or 404`,
    };
  }
  const live = parseSchemaIndex(body);
  if (live === undefined || !live.paths.every(isServedPath)) {
    return {
      pass: false,
      finding: `✗ deploy guard: ${indexUrl} is not a schema index { releases, paths }`,
    };
  }
  const built = new Set(
    live.paths.filter((path) => {
      const file = join(buildDir, path);
      return existsSync(file) && statSync(file).isFile();
    }),
  );
  const finding = guardServedSchemas(live, built);
  return finding === undefined
    ? { pass: true, reason: `this build serves all ${live.paths.length} paths ${indexUrl} lists` }
    : { pass: false, finding };
}

async function main(): Promise<void> {
  const result = await runGuard({ fetch: globalThis.fetch });
  if (!result.pass) {
    process.stderr.write(`${result.finding}\n`);
    process.exit(1);
  }
  process.stdout.write(`deploy guard: ${result.reason}\n`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) void main();
