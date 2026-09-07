import { readdirSync, readFileSync, statSync } from "node:fs";
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

const cwd = process.cwd();
const srcDir = join(cwd, "src");
const tsFiles = walkTs(srcDir);
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

process.stdout.write(JSON.stringify({ diagnostics }) + "\n");
