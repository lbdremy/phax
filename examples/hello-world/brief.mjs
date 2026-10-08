import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const NODE_IMPORT_RE = /(?:from\s+|import\s*\(\s*|import\s+|require\(\s*)["']node:([^"']+)["']/;

// The brief request phax writes on stdin: {$schema, phase, base, terminal,
// phases, files} inside a phase, {$schema, files} outside one. Read the
// stream to its end; readFileSync(0) fails on some pipes.
async function readRequest() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return JSON.parse(text);
}

// The files to brief: the named paths, or, for the phase's brief (files
// null), the gated phase's planned files.
function briefedFiles(request) {
  if (request.files !== null && request.files !== undefined) return request.files;
  return request.phases?.find((phase) => phase.id === request.phase)?.files ?? [];
}

// null outside a phase; `later` when only a later phase plans the file;
// `this-phase` otherwise.
function dueOf(request, file) {
  if (request.phase === undefined) return null;
  const index = request.phases.findIndex((phase) => phase.id === request.phase);
  const plannedNow = request.phases[index]?.files.includes(file) ?? false;
  const plannedLater = request.phases.slice(index + 1).some((phase) => phase.files.includes(file));
  return plannedLater && !plannedNow ? "later" : "this-phase";
}

// One `hw-no-io` place per .ts file under src/: forbidden at its first
// node: import, met otherwise (a file that does not exist yet included).
function placeOf(request, file, cwd) {
  const path = join(cwd, file);
  const lines = existsSync(path) ? readFileSync(path, "utf8").split("\n") : [];
  const index = lines.findIndex((line) => NODE_IMPORT_RE.test(line));
  if (index === -1) return { location: { file }, state: "met" };
  const module = NODE_IMPORT_RE.exec(lines[index])[1];
  return {
    location: { file, line: index + 1 },
    state: "forbidden",
    due: dueOf(request, file),
    what: `imports node:${module}`,
    repair: "remove the import; greet is pure",
  };
}

const request = await readRequest();
const cwd = process.cwd();
const places = briefedFiles(request)
  .filter((file) => file.startsWith("src/") && file.endsWith(".ts"))
  .map((file) => placeOf(request, file, cwd));
const guarantees =
  places.length === 0
    ? []
    : [{ id: "hw-no-io", statement: "nothing under src/ imports a node: module", places }];

process.stdout.write(
  JSON.stringify({
    $schema: "https://docs.phax.run/schemas/brief-answer/0.19.0.json",
    guarantees,
  }) + "\n",
);
