const ROWS = [
  {
    id: "keep-it-simple",
    title: "Keep hello-world a single file",
    severity: "info",
    trigger: "src/",
    body: "hello-world is a teaching example — all logic lives in src/greet.ts. Resist splitting it into helpers or adding abstractions that a real project would justify.",
  },
  {
    id: "no-io",
    title: "greet has no side effects and no I/O",
    severity: "error",
    trigger: "src/",
    body: "greet() must be a pure function. Do not import from node:fs, node:child_process, node:net, or any other I/O module. The audit gate enforces this.",
  },
  {
    id: "no-deps",
    title: "No third-party dependencies",
    severity: "warn",
    trigger: "src/",
    body: "hello-world carries no runtime dependencies. Keep package.json devDependencies only. Using external packages defeats the purpose of the example.",
  },
];

// Read the request from the stdin stream rather than opening /dev/stdin:
// on Linux that path fails with ENXIO when the parent hands over a pipe.
let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input.trim());

if ("files" in request) {
  const files = request.files;
  const rows = ROWS.filter((r) => files.some((f) => f.startsWith(r.trigger))).map((r) => ({
    id: r.id,
    title: r.title,
    severity: r.severity,
    trigger: r.trigger,
  }));
  process.stdout.write(JSON.stringify({ rows }) + "\n");
} else if ("expand" in request) {
  const found = ROWS.find((r) => r.id === request.expand) ?? null;
  if (found === null) {
    process.stdout.write(JSON.stringify({ row: null }) + "\n");
  } else {
    process.stdout.write(
      JSON.stringify({
        row: {
          id: found.id,
          title: found.title,
          severity: found.severity,
          trigger: found.trigger,
          body: found.body,
        },
      }) + "\n",
    );
  }
}
