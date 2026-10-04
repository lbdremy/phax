// The docs site's one entry: `pnpm site:build|site:dev|site:preview`.
//   build    generate site/generated/, build it with Rspress into
//            site/doc_build, then run the post-build checks
//   dev      generate, then serve it with Rspress's dev server
//   preview  serve the built site/doc_build
// Every finding is printed as a `✗ …` line and fails the build. Runs offline.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import pageMap from "../pages.js";
import {
  generateSite,
  linksLine,
  readPublicAssets,
  schemasLine,
  summaryLine,
  writeGeneratedSite,
  type SiteJson,
} from "./generate.js";
import type { RepositoryIndex, SiteLink } from "./links.js";
import {
  checkBuiltSite,
  checkLinkAnchors,
  checkServedSchemas,
  readBuiltPublic,
  readBuiltSite,
} from "./postbuild.js";
import { readSchemaSources } from "./schemas.js";
import { readSources } from "./sources.js";

const SITE_DIR = resolve(import.meta.dirname, "..");
const REPO_ROOT = resolve(SITE_DIR, "..");
const GENERATED_DIR = resolve(SITE_DIR, "generated");
const OUT_DIR = resolve(SITE_DIR, "doc_build");
const CONFIG_FILE = resolve(SITE_DIR, "rspress.config.ts");

const MODES = ["build", "dev", "preview"] as const;
type Mode = (typeof MODES)[number];

function fail(findings: ReadonlyArray<string>): never {
  for (const finding of findings) process.stderr.write(`${finding}\n`);
  process.exit(1);
}

function rootVersion(): string {
  const manifest = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as {
    readonly version?: unknown;
  };
  if (typeof manifest.version !== "string") throw new Error("package.json has no version");
  return manifest.version;
}

/**
 * The repository on disk. Names are matched case-exactly, as on GitHub, even
 * on a case-insensitive filesystem.
 */
function diskRepository(root: string): RepositoryIndex {
  const listings = new Map<string, ReadonlyMap<string, "file" | "directory">>();
  const listing = (directory: string): ReadonlyMap<string, "file" | "directory"> => {
    const cached = listings.get(directory);
    if (cached !== undefined) return cached;
    const entries = new Map<string, "file" | "directory">();
    try {
      for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
        if (entry.isFile()) entries.set(entry.name, "file");
        else if (entry.isDirectory()) entries.set(entry.name, "directory");
      }
    } catch {
      // Not a directory: it lists nothing.
    }
    listings.set(directory, entries);
    return entries;
  };
  return {
    kind: (path) => {
      if (path === "") return "directory";
      const segments = path.split("/");
      let kind: "file" | "directory" | undefined = "directory";
      for (let index = 0; index < segments.length; index++) {
        if (kind !== "directory") return undefined;
        kind = listing(segments.slice(0, index).join("/")).get(segments[index] ?? "");
      }
      return kind;
    },
  };
}

/** Generates site/generated/ and returns the files Rspress must copy verbatim. */
function generate(): ReadonlyMap<string, Uint8Array> {
  const result = generateSite({
    files: readSources(REPO_ROOT),
    pageMap,
    version: rootVersion(),
    repository: diskRepository(REPO_ROOT),
    schemas: readSchemaSources(REPO_ROOT),
    assets: readPublicAssets(resolve(SITE_DIR, "public")),
  });
  if (result.findings.length > 0) {
    fail(
      result.summary.links.broken > 0
        ? [...result.findings, linksLine(result.summary)]
        : result.findings,
    );
  }
  writeGeneratedSite(GENERATED_DIR, result.files, result.publicFiles);
  const lines = [
    summaryLine(result.summary),
    linksLine(result.summary),
    schemasLine(result.summary),
  ];
  for (const line of lines) if (line !== undefined) process.stdout.write(`${line}\n`);
  return result.publicFiles;
}

/**
 * Runs the installed Rspress CLI in a plain Node process. @rspress/core
 * exports build/dev/serve, but under tsx's loader its SSG step imports the
 * server bundle without a default export and fails, so the CLI is spawned.
 */
function rspress(command: "build" | "dev" | "preview"): void {
  const require = createRequire(import.meta.url);
  const bin = resolve(dirname(require.resolve("@rspress/core/package.json")), "bin/rspress.js");
  const result = spawnSync(process.execPath, [bin, command, "--config", CONFIG_FILE], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  if (result.status !== 0)
    fail([`✗ rspress ${command} exited with ${result.status ?? result.signal}`]);
}

function run(mode: Mode): void {
  if (mode === "preview") return rspress("preview");
  const publicFiles = generate();
  if (mode === "dev") return rspress("dev");
  rspress("build");
  const site = JSON.parse(readFileSync(resolve(GENERATED_DIR, "site.json"), "utf8")) as SiteJson;
  const links = JSON.parse(
    readFileSync(resolve(GENERATED_DIR, "links.json"), "utf8"),
  ) as ReadonlyArray<SiteLink>;
  const built = readBuiltSite(OUT_DIR);
  const findings = [
    ...checkBuiltSite(site, built),
    ...checkLinkAnchors(links, built),
    ...checkServedSchemas(publicFiles, readBuiltPublic(OUT_DIR, publicFiles.keys())),
  ];
  if (findings.length > 0) fail(findings);
  process.stdout.write("site: built site/doc_build\n");
}

const mode = process.argv[2];
if (!MODES.includes(mode as Mode)) {
  process.stderr.write(`usage: tsx site/build/site.ts <${MODES.join("|")}>\n`);
  process.exit(2);
}
run(mode as Mode);
