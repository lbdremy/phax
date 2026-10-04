// The docs site's one entry: `pnpm site:build|site:dev|site:preview`.
//   build    generate site/generated/, build it with Rspress into
//            site/doc_build, then run the post-build checks
//   dev      generate, then serve it with Rspress's dev server
//   preview  serve the built site/doc_build
// Every finding is printed as a `✗ …` line and fails the build. Runs offline.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import pageMap from "../pages.js";
import { generateSite, summaryLine, writeGeneratedSite, type SiteJson } from "./generate.js";
import { checkBuiltSite, readBuiltSite } from "./postbuild.js";
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

function generate(): void {
  const result = generateSite({ files: readSources(REPO_ROOT), pageMap, version: rootVersion() });
  if (result.findings.length > 0) fail(result.findings);
  writeGeneratedSite(GENERATED_DIR, result.files);
  process.stdout.write(`${summaryLine(result.summary)}\n`);
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
  generate();
  if (mode === "dev") return rspress("dev");
  rspress("build");
  const site = JSON.parse(readFileSync(resolve(GENERATED_DIR, "site.json"), "utf8")) as SiteJson;
  const findings = checkBuiltSite(site, readBuiltSite(OUT_DIR));
  if (findings.length > 0) fail(findings);
  process.stdout.write("site: built site/doc_build\n");
}

const mode = process.argv[2];
if (!MODES.includes(mode as Mode)) {
  process.stderr.write(`usage: tsx site/build/site.ts <${MODES.join("|")}>\n`);
  process.exit(2);
}
run(mode as Mode);
