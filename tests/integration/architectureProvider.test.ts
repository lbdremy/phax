import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pullArchitecture } from "../../src/app/architectureProvider.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { CURRENT_STAMPS } from "../../src/schemas/release.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// Made-up provider scripts in a temp dir. Each saves its stdin to a file
// outside the repository, so a refused path leaves no capture file.

let base: string;
let root: string;
let capture: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), "phax-architecture-provider-")));
  root = join(base, "repo");
  mkdirSync(join(root, "src"), { recursive: true });
  capture = join(base, "stdin.json");
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

const reportJson = (body: string) =>
  JSON.stringify({
    $schema: schemaUrl("architecture-report", CURRENT_STAMPS["architecture-report"]),
    body,
  });

/** A provider that saves its stdin, writes `stderr`, prints `stdout` and exits `code`. */
function provider(stdout: string, code = 0, stderr = ""): string {
  const script = join(base, "acme-guard.mjs");
  writeFileSync(
    script,
    [
      `import { writeFileSync } from "node:fs";`,
      `let stdin = "";`,
      `for await (const chunk of process.stdin) stdin += chunk;`,
      `writeFileSync(${JSON.stringify(capture)}, stdin);`,
      `process.stdout.write(${JSON.stringify(stdout)});`,
      `process.stderr.write(${JSON.stringify(stderr)});`,
      `process.exitCode = ${code};`,
    ].join("\n"),
  );
  return `node ${script}`;
}

function pull(
  command: string,
  paths: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
) {
  return Effect.runPromise(
    pullArchitecture({
      command,
      root,
      cwd: options.cwd ?? root,
      paths,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    }).pipe(Effect.provide(NodeShellLayer)),
  );
}

const sent = () => JSON.parse(readFileSync(capture, "utf8")) as Record<string, unknown>;

describe("pullArchitecture", () => {
  it("with no path, sends files null and answers the body", async () => {
    const result = await pull(provider(reportJson("# Architecture — acme-billing")), []);
    expect(result).toEqual({ kind: "answered", body: "# Architecture — acme-billing" });
    const request = sent();
    expect(request["$schema"]).toMatch(
      /^https:\/\/docs\.phax\.run\/schemas\/architecture-request\/\d+\.\d+\.\d+\.json$/,
    );
    expect(request["files"]).toBeNull();
    expect(Object.keys(request)).toEqual(["$schema", "files"]);
  });

  it("resolves paths from the cwd, root-relative and deduplicated, without checking existence", async () => {
    await pull(
      provider(reportJson("x")),
      ["core/billing/totals.ts", "core/billing/totals.ts", "http/missing.ts"],
      { cwd: join(root, "src") },
    );
    expect(sent()["files"]).toEqual(["src/core/billing/totals.ts", "src/http/missing.ts"]);
  });

  it("refuses a path outside the tree, naming it, before running the provider", async () => {
    const result = await pull(provider(reportJson("x")), ["../elsewhere"]);
    expect(result).toEqual({
      kind: "refused",
      message: "../elsewhere is outside the working tree",
    });
    expect(existsSync(capture)).toBe(false);
  });

  it("fails a provider that exits non-zero, naming the code and its stderr", async () => {
    const result = await pull(provider("", 3, "no ledger found\nsecond line"), []);
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toContain("architecture provider exited with code 3");
    expect(result.reason).toContain("no ledger found second line");
    expect(result.reason).not.toContain("\n");
  });

  it("fails a report without $schema, naming the architecture-report URL", async () => {
    const result = await pull(provider(JSON.stringify({ body: "x" })), []);
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toContain("architecture provider");
    expect(result.reason).toMatch(/schemas\/architecture-report\/\d+\.\d+\.\d+\.json/);
    expect(result.reason).not.toContain("\n");
  });

  it("fails output that is not JSON", async () => {
    const result = await pull(provider("not json"), []);
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toContain("architecture provider returned invalid JSON");
    expect(result.reason).not.toContain("\n");
  });

  it("fails a provider that outruns the time limit, naming it", async () => {
    const script = join(base, "acme-slow.mjs");
    writeFileSync(script, `await new Promise((resolve) => setTimeout(resolve, 10000));`);
    const result = await pull(`node ${script}`, [], { timeoutMs: 200 });
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.reason).toContain("timed out after 200ms");
    expect(result.reason).not.toContain("\n");
  });
});
