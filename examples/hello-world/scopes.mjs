// Read the request from the stdin stream rather than opening /dev/stdin:
// on Linux that path fails with ENXIO when the parent hands over a pipe.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input.trim());

// A scope token is the first path segment under src/, extension stripped
// when that segment is itself a file (no further slash). Files outside src/
// carry no scope.
function scopeForFile(file) {
  if (!file.startsWith("src/")) return null;
  const first = file.slice("src/".length).split("/")[0];
  return first.includes(".") ? first.replace(/\.[^./]+$/, "") : first;
}

function scopesForFiles(files) {
  const scopes = new Set();
  for (const file of files) {
    const scope = scopeForFile(file);
    if (scope !== null) scopes.add(scope);
  }
  return scopes;
}

const gatedIndex = request.phases.findIndex((p) => p.id === request.phase);
const upToGated = request.phases.slice(0, gatedIndex + 1);
const afterGated = request.phases.slice(gatedIndex + 1);

const touchedUpToGated = new Set();
for (const phase of upToGated) {
  for (const scope of scopesForFiles(phase.files)) touchedUpToGated.add(scope);
}
const touchedAfterGated = new Set();
for (const phase of afterGated) {
  for (const scope of scopesForFiles(phase.files)) touchedAfterGated.add(scope);
}

const closed = [...touchedUpToGated].filter((scope) => !touchedAfterGated.has(scope));

process.stdout.write(JSON.stringify({ closed }) + "\n");
