// The error ratchet of the Effect 4 migration: `pnpm codemod:effect4 --ratchet`.
//
// The counts live in RATCHET_FILE. The base of a phase is that file as committed at
// `HEAD` (read with `git show`), never the working tree's copy: phax's gates run before
// it commits, so HEAD is the previous phase's result and the working tree may have been
// edited by the phase itself.
//
//   no file at HEAD   record: the measured counts are written, the run passes
//   counts at or under the base   pass: the measured counts are written for the next base
//   a count above its base   fail: nothing is written, exit 1
//   a file at HEAD that is not `{ src, tests }` of numbers   fail
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { measureCounts, type Counts } from "./counts.js";

export const RATCHET_FILE = "scripts/effect4-codemod/type-error-counts.json";

export type Verdict =
  | { readonly kind: "record" }
  | { readonly kind: "pass" }
  | { readonly kind: "fail"; readonly exceeded: ReadonlyArray<keyof Counts> };

const COUNT_NAMES = ["src", "tests"] as const;

/** `base` null means no counts committed yet: the measured counts are the first. */
export function judge(base: Counts | null, measured: Counts): Verdict {
  if (base === null) return { kind: "record" };
  const exceeded = COUNT_NAMES.filter((name) => measured[name] > base[name]);
  return exceeded.length === 0 ? { kind: "pass" } : { kind: "fail", exceeded };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** The counts file's JSON, narrowed by hand: exactly `src` and `tests`, both counts. */
export function toCounts(value: unknown): Counts | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("src") || !keys.includes("tests")) return null;
  const { src, tests } = value;
  return isCount(src) && isCount(tests) ? { src, tests } : null;
}

export function serializeCounts(counts: Counts): string {
  return `${JSON.stringify({ src: counts.src, tests: counts.tests }, null, 2)}\n`;
}

export type Base =
  | { readonly kind: "none" }
  | { readonly kind: "found"; readonly counts: Counts }
  | { readonly kind: "malformed"; readonly reason: string }
  | { readonly kind: "unreadable"; readonly reason: string };

function git(
  root: string,
  args: ReadonlyArray<string>,
): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.error === undefined ? (result.stderr ?? "") : result.error.message,
  };
}

/** The counts committed at HEAD. A path HEAD does not hold is `none`; the working tree is never read. */
export function readBase(root: string): Base {
  const inside = git(root, ["rev-parse", "--git-dir"]);
  if (!inside.ok) return { kind: "unreadable", reason: `${root} is not a git repository` };
  // An unborn HEAD (no commit yet) holds no file either.
  if (!git(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).ok) return { kind: "none" };
  const listed = git(root, ["ls-tree", "--name-only", "HEAD", "--", RATCHET_FILE]);
  if (!listed.ok)
    return { kind: "unreadable", reason: `git ls-tree failed: ${listed.stderr.trim()}` };
  if (listed.stdout.trim() === "") return { kind: "none" };
  const shown = git(root, ["show", `HEAD:${RATCHET_FILE}`]);
  if (!shown.ok) return { kind: "unreadable", reason: `git show failed: ${shown.stderr.trim()}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(shown.stdout);
  } catch {
    return { kind: "malformed", reason: `${RATCHET_FILE} at HEAD is not valid JSON` };
  }
  const counts = toCounts(parsed);
  return counts === null
    ? {
        kind: "malformed",
        reason: `${RATCHET_FILE} at HEAD is not { "src": number, "tests": number }`,
      }
    : { kind: "found", counts };
}

export type RatchetOptions = {
  /** Measures the counts of `root`; `measureCounts` by default. */
  readonly measure?: (root: string) => Counts;
  /** Where the report goes; stdout by default. */
  readonly write?: (text: string) => void;
};

/** Runs the ratchet: 0 on record or pass, 1 on a failure. */
export function runRatchet(root: string, options: RatchetOptions = {}): number {
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  const measure = options.measure ?? ((from: string) => measureCounts(from));
  const base = readBase(root);
  if (base.kind === "malformed" || base.kind === "unreadable") {
    write(`ratchet: ${base.reason}\n`);
    return 1;
  }
  const measured = measure(root);
  const baseCounts = base.kind === "found" ? base.counts : null;
  const verdict = judge(baseCounts, measured);
  const row = (name: keyof Counts): string =>
    `${name.padEnd(6)}${String(baseCounts?.[name] ?? "-").padStart(5)}  ${String(measured[name]).padStart(8)}`;
  const table = ["type errors   base  measured", row("src"), row("tests")];
  if (verdict.kind === "fail") {
    write(
      `${table.join("\n")}\nratchet: failed, ${verdict.exceeded.join(" and ")} above the base committed at HEAD\n`,
    );
    return 1;
  }
  const file = join(root, RATCHET_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeCounts(measured));
  const outcome =
    verdict.kind === "record"
      ? `recorded the first counts in ${RATCHET_FILE}`
      : `passed, recorded the counts in ${RATCHET_FILE}`;
  write(`${table.join("\n")}\nratchet: ${outcome}\n`);
  return 0;
}
