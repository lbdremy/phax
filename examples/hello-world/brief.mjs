import { EXPORTS_FUNCTION, NO_NODE_IMPORT, findingsFor } from "./rules.mjs";

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

const request = await readRequest();
const files = briefedFiles(request).filter(
  (file) => file.startsWith("src/") && file.endsWith(".ts"),
);
// Both rules cover every briefed file, a file not written yet included; the
// findings are those of the files that exist.
const rules =
  files.length === 0
    ? []
    : [EXPORTS_FUNCTION, NO_NODE_IMPORT].map(({ rule, guide }) => ({ rule, files, guide }));
const findings = findingsFor(process.cwd(), files).map((finding) => ({
  ...finding,
  due: dueOf(request, finding.location.file),
}));

process.stdout.write(
  JSON.stringify({
    $schema: "https://docs.phax.run/schemas/brief-report/0.21.0.json",
    rules,
    findings,
  }) + "\n",
);
