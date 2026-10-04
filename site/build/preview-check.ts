// The preview check: the release and docs-deploy workflows run it between
// `wrangler versions upload` and `wrangler versions deploy`. It reads the
// uploaded version's id and preview alias URL from wrangler's ND-JSON output
// file (WRANGLER_OUTPUT_FILE_PATH), requires that preview to serve the
// release's registry schema as CORS-readable JSON and a home page labelled
// with the release, then hands the version id to the promote step as the
// step output `version-id`. It reads no credential. Exits 1 on failure.
//   tsx site/build/preview-check.ts --upload-output <file> --tag vX.Y.Z
import { appendFileSync, readFileSync } from "node:fs";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { Fetch } from "./deploy-guard.js";

const ATTEMPTS = 12;
const RETRY_DELAY_MS = 5_000;
const FETCH_TIMEOUT_MS = 30_000;

/** The preview alias for a release tag, as release.yml's `${RELEASE_TAG//./-}`: v0.18.0 → v0-18-0. */
export function previewAlias(tag: string): string {
  return tag.replaceAll(".", "-");
}

export interface Upload {
  readonly versionId: string;
  readonly previewUrl: string;
}

/**
 * The version id and preview alias URL of the last `version-upload` entry in
 * wrangler's ND-JSON output. Throws when there is no such entry or it lacks
 * either field (wrangler omits the alias URL when preview URLs are disabled).
 */
export function readUpload(ndjson: string): Upload {
  const entries = ndjson
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => {
      try {
        return JSON.parse(line);
      } catch {
        return undefined;
      }
    });
  const upload = entries.findLast(
    (entry): entry is Readonly<Record<string, unknown>> =>
      typeof entry === "object" &&
      entry !== null &&
      (entry as { readonly type?: unknown }).type === "version-upload",
  );
  if (upload === undefined) {
    throw new Error("✗ preview check: wrangler's output holds no version-upload entry");
  }
  const versionId = upload["version_id"];
  const previewUrl = upload["preview_alias_url"];
  if (typeof versionId !== "string" || versionId === "") {
    throw new Error("✗ preview check: wrangler's version-upload entry has no version_id");
  }
  if (typeof previewUrl !== "string" || previewUrl === "") {
    throw new Error(
      "✗ preview check: wrangler's version-upload entry has no preview_alias_url; are preview URLs enabled on the Worker?",
    );
  }
  return { versionId, previewUrl };
}

/** What one probe of the preview saw that fails the check, or undefined when it passes. */
async function probe(
  fetch: Fetch,
  previewUrl: string,
  release: string,
): Promise<string | undefined> {
  const base = previewUrl.replace(/\/+$/, "");
  const schemaUrl = `${base}/schemas/registry/${release}.json`;
  const homeUrl = `${base}/`;
  try {
    const schema = await fetch(schemaUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    await schema.body?.cancel();
    const contentType = schema.headers.get("content-type") ?? "(none)";
    const cors = schema.headers.get("access-control-allow-origin") ?? "(none)";
    if (schema.status !== 200) return `${schemaUrl} answered ${schema.status}`;
    if (!contentType.startsWith("application/json")) {
      return `${schemaUrl} answered Content-Type ${contentType}`;
    }
    if (cors !== "*") return `${schemaUrl} answered Access-Control-Allow-Origin ${cors}`;
    const home = await fetch(homeUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const body = await home.text();
    if (home.status !== 200) return `${homeUrl} answered ${home.status}`;
    if (!body.includes(`v${release}`)) return `${homeUrl} does not show v${release}`;
    return undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return `could not fetch the preview at ${base}: ${reason}`;
  }
}

/**
 * Probes the preview up to `attempts` times, sleeping between probes, until
 * it serves the release; returns the last failure seen, or undefined.
 */
export async function checkPreview(options: {
  readonly fetch: Fetch;
  readonly sleep: (ms: number) => Promise<void>;
  readonly previewUrl: string;
  readonly release: string;
  readonly attempts?: number;
}): Promise<string | undefined> {
  const attempts = options.attempts ?? ATTEMPTS;
  let seen: string | undefined;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    seen = await probe(options.fetch, options.previewUrl, options.release);
    if (seen === undefined) return undefined;
    if (attempt < attempts) await options.sleep(RETRY_DELAY_MS);
  }
  return `✗ preview check: after ${attempts} attempts, ${seen}`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { "upload-output": { type: "string" }, tag: { type: "string" } },
  });
  const tag = values.tag ?? "";
  const uploadOutput = values["upload-output"];
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || uploadOutput === undefined) {
    process.stderr.write(
      "✗ preview check: usage: preview-check.ts --upload-output <file> --tag vX.Y.Z\n",
    );
    process.exit(1);
  }
  let upload: Upload;
  try {
    upload = readUpload(readFileSync(uploadOutput, "utf8"));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const failure = await checkPreview({
    fetch: globalThis.fetch,
    sleep: (ms) => setTimeout(ms),
    previewUrl: upload.previewUrl,
    release: tag.slice(1),
  });
  if (failure !== undefined) {
    process.stderr.write(`${failure}\n`);
    process.exit(1);
  }
  const githubOutput = process.env["GITHUB_OUTPUT"];
  if (githubOutput !== undefined && githubOutput !== "") {
    appendFileSync(githubOutput, `version-id=${upload.versionId}\n`);
  }
  process.stdout.write(
    `preview check: ${upload.previewUrl} serves ${tag} (version ${upload.versionId})\n`,
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) void main();
