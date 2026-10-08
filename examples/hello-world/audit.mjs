import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const NODE_IMPORT_RE = /from\s+"node:|require\("node:/;

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
// files, keeping only those that still exist.
function changedTs(cwd, base) {
  const paths = new Set([
    ...git(["diff", "--name-only", "--relative", base], cwd),
    ...git(["ls-files", "--others", "--exclude-standard"], cwd),
  ]);
  return [...paths]
    .filter((p) => p.startsWith("src/") && p.endsWith(".ts"))
    .map((p) => join(cwd, p))
    .filter((p) => existsSync(p))
    .toSorted();
}

const request = await readRequest();
const cwd = process.cwd();
// The terminal phase audits everything; any other phase only what it changed.
const tsFiles = request.terminal ? walkTs(join(cwd, "src")) : changedTs(cwd, request.base);
const diagnostics = [];

for (const filePath of tsFiles) {
  const lines = readFileSync(filePath, "utf8").split("\n");
  const rel = filePath.startsWith(cwd + "/") ? filePath.slice(cwd.length + 1) : filePath;
  lines.forEach((line, idx) => {
    if (NODE_IMPORT_RE.test(line)) {
      diagnostics.push({
        rule: "HW_NO_IO",
        class: "invariant",
        location: { file: rel, line: idx + 1 },
        message: "greet must not perform I/O",
        repair: "plan.md#phase-01-greet-function",
      });
    }
  });
}

process.stdout.write(
  JSON.stringify({
    $schema: "https://docs.phax.run/schemas/gate-diagnostics/0.19.0.json",
    diagnostics,
  }) + "\n",
);
