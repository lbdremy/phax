import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either } from "effect";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  queryBrief,
  serializeBriefRecord,
  stampBriefRequest,
  type BriefOutcome,
} from "../../src/app/briefProvider.js";
import { phaseBriefRequest } from "../../src/domain/brief/request.js";
import { NodeShellLayer } from "../../src/infra/shell.js";
import { currentSchemaUrl, readBriefRecordFile } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

// Every provider here is a made-up node script in a temp dir, run through the
// real Node shell; every request and answer is made up.

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "phax-brief-provider-")));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const request = stampBriefRequest(
  phaseBriefRequest(
    {
      phase: "phase-02",
      base: "0123456789abcdef0123456789abcdef01234567",
      terminal: false,
      phases: [
        { id: "phase-01", files: ["src/billing/port.ts"] },
        { id: "phase-02", files: ["src/billing/invoice.ts"] },
      ],
    },
    null,
  ),
);

const FINDING = {
  id: "core-no-adapters src/billing/invoice.ts",
  rule: "src/core imports no adapter from src/infra",
  location: { file: "src/billing/invoice.ts", lines: [3, 3] },
  message: "imports src/infra/stripe.ts",
  related: [],
  guide: { summary: "depend on PaymentPort", read: "docs/ports.md" },
  due: "this-phase",
};

function reportDocument(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    $schema: currentSchemaUrl("brief-report"),
    rules: [
      {
        rule: "src/core imports no adapter from src/infra",
        files: ["src/billing/invoice.ts"],
        guide: null,
      },
    ],
    findings: [FINDING],
    ...overrides,
  };
}

/** Writes a provider script that prints `stdout` verbatim and exits `code`. */
function printingProvider(stdout: string, code = 0, stderr = ""): string {
  const script = join(dir, "brief.mjs");
  writeFileSync(
    script,
    `process.stdout.write(${JSON.stringify(stdout)});\n` +
      `process.stderr.write(${JSON.stringify(stderr)});\n` +
      `process.exitCode = ${code};\n`,
  );
  return `node ${script}`;
}

function run(command: string, timeoutMs?: number): Promise<BriefOutcome> {
  return Effect.runPromise(
    queryBrief({
      command,
      request,
      cwd: dir,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    }).pipe(Effect.provide(NodeShellLayer)),
  );
}

function reasonOf(outcome: BriefOutcome): string {
  if (outcome.kind !== "failed") throw new Error(`expected a failed outcome, got answered`);
  return outcome.reason;
}

describe("queryBrief", () => {
  it("sends the stamped request on stdin and runs from the given root", async () => {
    const script = join(dir, "brief.mjs");
    writeFileSync(
      script,
      `import { writeFileSync } from "node:fs";
let input = "";
for await (const chunk of process.stdin) input += chunk;
writeFileSync("stdin.json", input);
writeFileSync("cwd.txt", process.cwd());
process.stdout.write(JSON.stringify({ $schema: ${JSON.stringify(
        currentSchemaUrl("brief-report"),
      )}, rules: [], findings: [] }));
`,
    );

    const outcome = await run(`node ${script}`);

    expect(outcome.kind).toBe("answered");
    expect(JSON.parse(readFileSync(join(dir, "stdin.json"), "utf8"))).toEqual(request);
    expect(readFileSync(join(dir, "cwd.txt"), "utf8")).toBe(dir);
  });

  it("keeps the report as printed and decodes it without $schema", async () => {
    const { $schema, rules, findings } = reportDocument();
    const printed = { findings, rules, $schema };
    const outcome = await run(printingProvider(JSON.stringify(printed)));

    expect(outcome.kind).toBe("answered");
    if (outcome.kind === "answered") {
      expect(Object.keys(outcome.answer as object)).toEqual(["findings", "rules", "$schema"]);
      expect(outcome.answer).toEqual(printed);
      expect(outcome.decoded).toStrictEqual({ rules, findings });
    }
  });

  it("decodes an empty report: nothing to report", async () => {
    const outcome = await run(
      printingProvider(JSON.stringify(reportDocument({ rules: [], findings: [] }))),
    );
    expect(outcome.kind === "answered" && outcome.decoded).toStrictEqual({
      rules: [],
      findings: [],
    });
  });

  it("names the exit code and the stderr text on a non-zero exit", async () => {
    const reason = reasonOf(await run(printingProvider("", 1, "  ledger missing\n")));
    expect(reason.startsWith("brief provider exited with code 1")).toBe(true);
    expect(reason).toContain("ledger missing");
  });

  it("names invalid JSON", async () => {
    const reason = reasonOf(await run(printingProvider("not json")));
    expect(reason).toContain("invalid JSON");
  });

  it("stops a provider that runs past the limit and names the timeout", async () => {
    const script = join(dir, "hang.mjs");
    const pidFile = join(dir, "pid.txt");
    writeFileSync(
      script,
      `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 1000);
`,
    );

    const reason = reasonOf(await run(`node ${script}`, 300));
    expect(reason).toContain("timed out");

    const pid = Number(readFileSync(pidFile, "utf8"));
    await expect
      .poll(
        () => {
          try {
            process.kill(pid, 0);
            return "alive";
          } catch {
            return "gone";
          }
        },
        { timeout: 5_000 },
      )
      .toBe("gone");
  });

  it("gives the provider's stderr when it declines to run", async () => {
    const reason = reasonOf(
      await run(printingProvider("", 2, "the checks need hw-rules 2, and 1 is installed\n")),
    );
    expect(reason).toBe(
      "brief provider exited with code 2: the checks need hw-rules 2, and 1 is installed",
    );
  });

  it.each([
    ["no $schema", { rules: [], findings: [] }],
    ["a newer release", { $schema: schemaUrl("brief-report", "99.0.0"), rules: [], findings: [] }],
    ["another format", { $schema: currentSchemaUrl("brief-request"), rules: [], findings: [] }],
    ["not a url", { $schema: "not a url", rules: [], findings: [] }],
  ])("refuses a report with %s, naming the brief-report URL it reads", async (_label, document) => {
    const reason = reasonOf(await run(printingProvider(JSON.stringify(document))));
    expect(reason).toContain(currentSchemaUrl("brief-report"));
  });

  it("names brief-report and the release of a newer report", async () => {
    const document = { $schema: schemaUrl("brief-report", "99.0.0"), rules: [], findings: [] };
    const reason = reasonOf(await run(printingProvider(JSON.stringify(document))));
    expect(reason).toContain("brief-report 99.0.0 is newer than this phax");
  });

  it.each([
    ["an extra top-level key", reportDocument({ review: [] }), "review"],
    ["an outcome key", reportDocument({ outcome: "checked" }), "outcome"],
    ["a finding id used twice", reportDocument({ findings: [FINDING, FINDING] }), FINDING.id],
    [
      "a lines pair out of order",
      reportDocument({ findings: [{ ...FINDING, location: { file: "src/a.ts", lines: [3, 1] } }] }),
      "src/a.ts",
    ],
    [
      "a due outside its values",
      reportDocument({ findings: [{ ...FINDING, due: "soon" }] }),
      "findings[0].due",
    ],
    [
      "a rule with no files",
      reportDocument({ rules: [{ rule: "r", files: [], guide: null }] }),
      "rules[0].files",
    ],
  ])("refuses a report with %s, naming it", async (_label, document, named) => {
    const reason = reasonOf(await run(printingProvider(JSON.stringify(document))));
    expect(reason).toContain(named);
    expect(reason).toContain(currentSchemaUrl("brief-report"));
  });
});

describe("serializeBriefRecord", () => {
  it("keeps the report as printed through a record round-trip", async () => {
    const { $schema, rules, findings } = reportDocument();
    const printed = { rules, findings, $schema };
    const outcome = await run(printingProvider(JSON.stringify(printed)));

    const read = readBriefRecordFile(
      "brief-00.json",
      JSON.parse(serializeBriefRecord("pushed", request, outcome)),
    );

    expect(Either.isRight(read)).toBe(true);
    if (Either.isRight(read)) {
      expect(read.right.moment).toBe("pushed");
      expect(read.right.request).toEqual(request);
      expect(read.right.outcome).toEqual({ kind: "answered", answer: printed });
      if (read.right.outcome.kind === "answered") {
        expect(Object.keys(read.right.outcome.answer)).toEqual(["rules", "findings", "$schema"]);
      }
    }
  });

  it("records a failed outcome with its reason", () => {
    const text = serializeBriefRecord("pulled", request, { kind: "failed", reason: "boom" });
    expect(text.endsWith("\n")).toBe(false);
    const read = readBriefRecordFile("brief-01.json", JSON.parse(text));
    expect(Either.isRight(read) && read.right.outcome).toEqual({ kind: "failed", reason: "boom" });
  });
});
