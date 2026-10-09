import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { findingsFor } from "./rules.mjs";

function walkTs(dir) {
  let files = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return files;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files = files.concat(walkTs(full));
    } else if (entry.endsWith(".ts")) {
      files.push(full);
    }
  }
  return files;
}

// The gate request phax writes on stdin: {$schema, phase, base, terminal, phases}.
// Read the stream to its end; readFileSync(0) fails on some pipes.
async function readRequest() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).split("\n").filter(Boolean);
}

// The .ts files under src/ changed since base: tracked changes plus untracked
// files. rules.mjs skips those that no longer exist.
function changedTs(cwd, base) {
  const paths = new Set([
    ...git(["diff", "--name-only", "--relative", base], cwd),
    ...git(["ls-files", "--others", "--exclude-standard"], cwd),
  ]);
  return [...paths].filter((p) => p.startsWith("src/") && p.endsWith(".ts")).toSorted();
}

const request = await readRequest();
const cwd = process.cwd();
// The terminal phase audits everything; any other phase only what it changed.
const tsFiles = request.terminal
  ? walkTs(join(cwd, "src"))
      .map((path) => relative(cwd, path))
      .toSorted()
  : changedTs(cwd, request.base);

process.stdout.write(
  JSON.stringify({
    $schema: "https://docs.phax.run/schemas/gate-report/0.21.0.json",
    outcome: "checked",
    findings: findingsFor(cwd, tsFiles),
    review: [],
  }) + "\n",
);
