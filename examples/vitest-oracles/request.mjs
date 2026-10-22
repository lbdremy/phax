// Reads the oracle request phax writes on stdin. Every defect that makes the
// request unreadable comes back as a refusal: one line naming the defect, one
// line saying what to do.

const SCHEMA = /^https:\/\/docs\.phax\.run\/schemas\/oracle-request\/\d+\.\d+\.\d+\.json$/;
const PHASE_ID = /^phase-\d{2}$/;
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SCRIPT_FILE = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;

const KEYS = {
  authored: ["$schema", "verdict", "phase", "oraclePhase", "base", "files"],
  discharged: ["$schema", "verdict", "phase", "oraclePhase", "base", "oracleCommit", "files"],
};

const FROM_PHAX = "Run this provider only as phax's oracles command, which writes a valid request.";

function refuse(reason, remedy) {
  return { refused: { reason, remedy } };
}

/** The first defect of an oracle file path, or null. */
function pathDefect(path) {
  if (typeof path !== "string" || path === "") return "is not a non-empty string";
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return "is absolute";
  if (path.split(/[\\/]/).includes("..")) return "has a .. segment";
  if (!SCRIPT_FILE.test(path)) {
    return "does not end in .ts, .tsx, .mts, .cts, .js, .jsx, .mjs or .cjs";
  }
  return null;
}

/**
 * Decode the raw stdin text: `{ request }`, or `{ refused: { reason, remedy } }`.
 * Whether `base` and `oracleCommit` are commits of the repository is git.mjs's check.
 */
export function readRequest(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse("stdin is not JSON", FROM_PHAX);
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return refuse("stdin is not a JSON object", FROM_PHAX);
  }
  if (typeof value.$schema !== "string") {
    return refuse("the request has no $schema", FROM_PHAX);
  }
  if (!SCHEMA.test(value.$schema)) {
    return refuse(
      `$schema ${JSON.stringify(value.$schema)} does not name the oracle-request format`,
      FROM_PHAX,
    );
  }
  const keys =
    typeof value.verdict === "string" && Object.hasOwn(KEYS, value.verdict)
      ? KEYS[value.verdict]
      : undefined;
  if (keys === undefined) {
    return refuse(
      `verdict ${JSON.stringify(value.verdict)} is neither "authored" nor "discharged"`,
      FROM_PHAX,
    );
  }
  const missing = keys.find((key) => !Object.hasOwn(value, key));
  if (missing !== undefined) {
    return refuse(`the ${value.verdict} request has no ${missing} key`, FROM_PHAX);
  }
  const extra = Object.keys(value).find((key) => !keys.includes(key));
  if (extra !== undefined) {
    return refuse(`the ${value.verdict} request does not take a ${extra} key`, FROM_PHAX);
  }
  for (const key of ["phase", "oraclePhase"]) {
    if (typeof value[key] !== "string" || !PHASE_ID.test(value[key])) {
      return refuse(
        `${key} ${JSON.stringify(value[key])} is not a phase id like phase-01`,
        FROM_PHAX,
      );
    }
  }
  for (const key of ["base", "oracleCommit"]) {
    if (!Object.hasOwn(value, key)) continue;
    if (typeof value[key] !== "string" || !COMMIT.test(value[key])) {
      return refuse(`${key} ${JSON.stringify(value[key])} is not a full commit hash`, FROM_PHAX);
    }
  }
  if (!Array.isArray(value.files) || value.files.length === 0) {
    return refuse("files is not a non-empty array", FROM_PHAX);
  }
  for (const path of value.files) {
    const defect = pathDefect(path);
    if (defect !== null) {
      return refuse(
        `file path ${JSON.stringify(path)} ${defect}`,
        "Declare the oracle files as relative paths to test scripts inside the working tree.",
      );
    }
  }
  return { request: value };
}
