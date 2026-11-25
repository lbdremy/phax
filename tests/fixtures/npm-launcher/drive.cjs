"use strict";

// Drives the npm launcher (npm/bin/phax) through a first run against a local
// fixture server hosted in this same process, for
// tests/integration/npmLauncherProcess.test.ts.
//
//   node drive.cjs <scenario> <home> <fake binary file> <log file> -- <binary args>
//
// The server listens on 127.0.0.1:0, logs every request as one JSON line
// ({ method, path }) to <log file>, serves <fake binary file> at
// /releases/v<version>/<name> and its sha256 line at the sidecar path.
// A `stall-<SIGNAL>` scenario sends half the binary, waits until the launcher's
// partial file holds bytes on disk, reports its size on stderr
// ("drive: partial file holds <n> bytes") and only then sends <SIGNAL>.
// This file starts no process itself: the launcher it requires does the
// spawning, inside the test's bounded process group.

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const launcher = require(path.join(__dirname, "..", "..", "..", "npm", "bin", "phax"));

const [scenario, home, fakeFile, logFile, separator, ...binaryArgs] = process.argv.slice(2);
if (separator !== "--") {
  process.stderr.write("usage: drive.cjs <scenario> <home> <fake> <log> -- <binary args>\n");
  process.exit(2);
}

const STALL_SIGNALS = {
  "stall-SIGINT": "SIGINT",
  "stall-SIGTERM": "SIGTERM",
  "stall-SIGHUP": "SIGHUP",
};

const name = launcher.getBinaryName(process.platform, process.arch);
const version = launcher.productionConfig().version;
const binaryPath = `/releases/v${version}/${name}`;
const sidecarPath = `${binaryPath}.sha256`;

function fakeBytes() {
  return fs.readFileSync(fakeFile);
}

// The size of the partial file in the launcher's private download directory, or 0.
function partialSize() {
  const versionDir = path.dirname(launcher.cachePath({ version, home }, name));
  let entries;
  try {
    entries = fs.readdirSync(versionDir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (!entry.startsWith(".download-")) continue;
    try {
      return fs.statSync(path.join(versionDir, entry, name)).size;
    } catch {}
  }
  return 0;
}

const PARTIAL_BOUND_MS = 10000;

function signalOncePartial(signal) {
  const started = Date.now();
  const poll = setInterval(() => {
    const size = partialSize();
    if (size > 0) {
      clearInterval(poll);
      process.stderr.write(`drive: partial file holds ${size} bytes\n`);
      process.kill(process.pid, signal);
    } else if (Date.now() - started > PARTIAL_BOUND_MS) {
      clearInterval(poll);
      process.stderr.write(`drive: no partial file within ${PARTIAL_BOUND_MS} ms\n`);
      process.exit(3);
    }
  }, 2);
}

function digestOf(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

const heldBinaries = [];

function serveBinary(res) {
  const body = fakeBytes();
  res.writeHead(200, { "Content-Length": body.length });
  res.end(body);
}

function onRequest(req, res) {
  fs.appendFileSync(logFile, `${JSON.stringify({ method: req.method, path: req.url })}\n`);

  if (req.url === binaryPath) {
    const stall = STALL_SIGNALS[scenario];
    if (stall) {
      const body = fakeBytes();
      res.writeHead(200, { "Content-Length": body.length + 1024 });
      res.write(body.subarray(0, Math.max(1, Math.floor(body.length / 2))), () => {
        signalOncePartial(stall);
      });
      return;
    }
    if (scenario === "concurrent") {
      heldBinaries.push(res);
      if (heldBinaries.length === 2) for (const held of heldBinaries.splice(0)) serveBinary(held);
      return;
    }
    serveBinary(res);
    return;
  }

  if (req.url === sidecarPath) {
    const bytes = scenario === "mismatch" ? Buffer.from("other bytes") : fakeBytes();
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`${digestOf(bytes)}  ${name}\n`);
    return;
  }

  if (req.url === "/update" && scenario === "update-stall") {
    // Accept the request and never answer.
    return;
  }

  res.writeHead(404);
  res.end();
}

async function run(config) {
  switch (scenario) {
    case "ok":
    case "mismatch":
    case "cached":
    case "stall-SIGINT":
    case "stall-SIGTERM":
    case "stall-SIGHUP":
      await launcher.launch(config, binaryArgs);
      return;
    case "update-stall":
      await launcher.launch({ ...config, updateTimeoutMs: 600000 }, binaryArgs);
      return;
    case "concurrent": {
      const outcomes = await Promise.all(
        [0, 1].map(async () => {
          const binPath = await launcher.ensureBinary(config, name);
          return launcher.startBinary(binPath, binaryArgs);
        }),
      );
      process.stdout.write(`${JSON.stringify(outcomes)}\n`);
      process.exit(0);
      return;
    }
    case "vanish": {
      const missing = launcher.cachePath(config, name);
      launcher.exitLike(await launcher.startBinary(missing, []), missing, config);
      return;
    }
    default:
      process.stderr.write(`unknown scenario: ${scenario}\n`);
      process.exit(2);
  }
}

const server = http.createServer(onRequest);
server.listen(0, "127.0.0.1", () => {
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const config = {
    ...launcher.productionConfig(),
    home,
    releaseBase: `${origin}/releases`,
    updateUrl: `${origin}/update`,
    transport: http,
    scheme: "http:",
    allowedHosts: { exact: ["127.0.0.1"], suffixes: [] },
  };
  run(config).catch((err) => {
    process.stderr.write(`drive: ${err && err.stack ? err.stack : String(err)}\n`);
    process.exit(3);
  });
});
