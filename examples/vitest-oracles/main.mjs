// The Vitest oracles provider: reads an oracle-request on stdin and prints one
// gate-report line on stdout. Exit 0 only for a checked report with no finding.
// An unexpected exception crashes with no report, and phax fails the step.
import { commitExists } from "./git.mjs";
import { readRequest } from "./request.mjs";
import { authoredFindings, dischargedFindings } from "./verdicts.mjs";

/** A gate report: the stamp of gate-report's current release, then the body. */
function gateReport(body) {
  return { $schema: "https://docs.phax.run/schemas/gate-report/0.21.0.json", ...body };
}

// Read the stream to its end; readFileSync(0) fails on some pipes.
async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

/** `{ findings }` or `{ refused }` for a decoded request. */
function judge(cwd, request) {
  for (const key of ["base", "oracleCommit"]) {
    const sha = request[key];
    if (sha !== undefined && !commitExists(cwd, sha)) {
      return {
        refused: {
          reason: `${key} ${sha} is not a commit of the repository in ${cwd}`,
          remedy: "Run the provider in the gated worktree, which holds the oracle phase's commits.",
        },
      };
    }
  }
  return request.verdict === "authored"
    ? authoredFindings(cwd, request)
    : dischargedFindings(cwd, request);
}

const decoded = readRequest(await readStdin());
const result = decoded.refused === undefined ? judge(process.cwd(), decoded.request) : decoded;
const report =
  result.refused === undefined
    ? gateReport({ outcome: "checked", findings: result.findings, review: [] })
    : gateReport({ outcome: "refused", ...result.refused });

process.stdout.write(JSON.stringify(report) + "\n");
process.exitCode = report.outcome === "checked" && report.findings.length === 0 ? 0 : 1;
