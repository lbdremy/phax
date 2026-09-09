// Read the request from the stdin stream rather than opening /dev/stdin:
// on Linux that path fails with ENXIO when the parent hands over a pipe.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input.trim());

const SRC_FILE = /^src\/(.+)\.ts$/;

const findings = [];
request.phases.forEach((phase, index) => {
  for (const file of phase.files) {
    const match = SRC_FILE.exec(file);
    if (match === null) continue;
    const testFile = `tests/${match[1]}.test.ts`;
    const laterPhases = request.phases.slice(index);
    const paired = laterPhases.some((p) => p.files.includes(testFile));
    if (!paired) {
      findings.push({
        message: `${phase.id} touches ${file}; no later phase touches ${testFile}`,
        phases: [phase.id],
      });
    }
  }
});

process.stdout.write(JSON.stringify({ findings }) + "\n");
