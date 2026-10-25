import { describe, expect, it } from "vitest";
import type { DecideVerdictsResult } from "../../../src/app/decideVerdicts.js";
import {
  renderVerdictsReport,
  runArtifactDecide,
  verdictsReportJson,
} from "../../../src/cli/commands/artifactDecide.js";

// Flag rules and report rendering of `phax artifact decide --verdicts`. The
// use case has its own suites; every artifact, id and hash here is made up.

function makeOutput() {
  const lines: string[] = [];
  const errors: string[] = [];
  const out = {
    log: (m: string) => lines.push(m),
    warn: (m: string) => lines.push(`WARN: ${m}`),
    error: (m: string) => errors.push(m),
  };
  return { out, lines, errors };
}

describe("runArtifactDecide — flag rules", () => {
  it.each([
    [
      "--verdicts with --question",
      { verdicts: "v.json", question: "q-keep" },
      "--question and --verdicts are exclusive — the verdicts file names the questions",
    ],
    ["--json without --verdicts", { json: true }, "--json needs --verdicts"],
    ["--by without --verdicts", { by: "operator" }, "--by needs --verdicts"],
  ])("%s exits 12 naming the flags, before anything is loaded", async (_name, opts, message) => {
    const { out, lines, errors } = makeOutput();

    const code = await runArtifactDecide("docs/specs/2610250900-log-rotation.md", opts, out);

    expect(code).toBe(12);
    expect(errors).toEqual([`✗ ${message}`]);
    expect(lines).toEqual([]);
  });
});

const BY = { kind: "operator", name: "Ada Lovelace" } as const;

const RESULT: DecideVerdictsResult = {
  kind: "committed",
  path: "docs/specs/2610250900-log-rotation.md",
  paths: ["docs/specs/2610250900-log-rotation.md", "docs/specs/2610250900-log-rotation.json"],
  status: "Draft",
  session: "resumed-authoring",
  provider: "claude-code",
  model: "claude-sonnet-5-5",
  requestedModel: "claude-sonnet-5-5",
  effort: "medium",
  modelSource: "built-in default",
  effortSource: "built-in default",
  verdicts: [
    {
      question: "q-keep",
      chosen: "keep-20",
      recommendation: "keep-10",
      departs: true,
      why: "Twenty runs cover one release cycle.",
      revised: ["§5.2", "AC keep bound"],
      by: BY,
    },
    {
      question: "q-scope",
      chosen: "per-run",
      recommendation: "per-run",
      departs: false,
      why: "One log per run is what a bug report attaches.",
      revised: [],
      by: BY,
    },
  ],
  open: ["q-names"],
  diff: "--- a/x.md\n+++ b/x.md\n@@ -1 +1 @@\n-keep 10\n+keep 20\n",
  commit: { hash: "c4d5e6f7a8b9", subject: "docs(specs): decide log-rotation q-keep, q-scope" },
  decisionId: "2610250900-log-rotation/01",
  record: { kind: "records-off" },
  recordPush: { kind: "not-attempted" },
} as unknown as DecideVerdictsResult;

describe("renderVerdictsReport", () => {
  it("lists each verdict with follows or departs, why and revised, the open questions, the diff, the commit and the Draft status", () => {
    const lines = renderVerdictsReport(RESULT);

    expect(lines).toEqual([
      "q-keep     keep-20   departs from keep-10 — revised: §5.2, AC keep bound",
      "           why: Twenty runs cover one release cycle.",
      "q-scope    per-run   (recommended)",
      "           why: One log per run is what a bug report attaches.",
      "q-names    open      (not in the verdicts file)",
      "--- a/x.md\n+++ b/x.md\n@@ -1 +1 @@\n-keep 10\n+keep 20",
      "commit     c4d5e6f — docs(specs): decide log-rotation q-keep, q-scope",
      "status     Draft — read the verdicts and the diff above, then `phax artifact approve docs/specs/2610250900-log-rotation.md`",
    ]);
  });

  it("omits the diff block when the body did not change", () => {
    const lines = renderVerdictsReport({ ...RESULT, diff: "" });

    expect(lines.some((l) => l.startsWith("---"))).toBe(false);
  });
});

describe("verdictsReportJson", () => {
  it("holds exactly the report keys, with no $schema", () => {
    const report = verdictsReportJson(RESULT) as Record<string, unknown>;

    expect(Object.keys(report)).toEqual([
      "artifact",
      "status",
      "session",
      "provider",
      "model",
      "requestedModel",
      "effort",
      "verdicts",
      "open",
      "diff",
      "commit",
      "decisionId",
    ]);
    expect(report["commit"]).toEqual({
      hash: "c4d5e6f7a8b9",
      subject: "docs(specs): decide log-rotation q-keep, q-scope",
    });
    expect((report["verdicts"] as Array<Record<string, unknown>>)[0]).toEqual({
      question: "q-keep",
      chosen: "keep-20",
      recommendation: "keep-10",
      departs: true,
      why: "Twenty runs cover one release cycle.",
      revised: ["§5.2", "AC keep bound"],
      by: BY,
    });
  });
});
