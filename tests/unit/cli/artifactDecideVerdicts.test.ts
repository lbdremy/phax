import { describe, expect, it } from "vitest";
import type { DecideVerdictsResult } from "../../../src/app/decideVerdicts.js";
import {
  makeArtifactDecideCommand,
  renderVerdictsReport,
  verdictsReportJson,
} from "../../../src/cli/definitions/artifactDecide.js";
import { inArtifact, runnerCall } from "../../helpers/runnerCall.js";
import { FILE_VALID } from "../decide/verdictsFixtures.js";

// Flag rules and report rendering of `phax artifact decide --verdicts`, the flag rules through
// the command runner over a memory Io. The use case has its own suites; every artifact, id and
// hash here is made up.

const SPEC = "docs/specs/2610250900-log-rotation.md";

const decide = (argv: ReadonlyArray<string>) =>
  runnerCall([inArtifact(makeArtifactDecideCommand())], ["artifact", "decide", SPEC, ...argv], {
    files: { "v.json": FILE_VALID },
  });

describe("phax artifact decide — flag rules", () => {
  it.each([
    [
      "--verdicts with --question",
      ["--verdicts", "v.json", "--question", "q-keep"],
      "--question and --verdicts are exclusive — the verdicts file names the questions",
    ],
    ["--by without --verdicts", ["--by", "operator"], "--by needs --verdicts"],
  ])("%s exits 12 naming the flags, before anything is loaded", async (_name, argv, message) => {
    const called = await decide(argv);

    expect(called.code).toBe(12);
    expect(called.errLines).toEqual([`✗ ${message}`]);
    expect(called.outLines).toEqual([]);
  });

  // Changed by §5.20: --json without --verdicts would open an interactive session, so the runner
  // refuses it as a prompting call with 64 and one refused line, where decide answered 12 with
  // `✗ --json needs --verdicts`.
  it("--json without --verdicts is refused with 64 before anything runs, naming --json", async () => {
    const called = await decide(["--json"]);

    expect(called.code).toBe(64);
    expect(called.outLines).toEqual([]);
    expect(called.errLines).toHaveLength(1);
    expect(JSON.parse(called.errLines[0]!)).toMatchObject({
      kind: "refused",
      source: "flags",
      path: ["json"],
      exit: 64,
    });
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
      "status     Draft — read the verdicts and the diff above, then `phax artifact approve docs/specs/2610250900-log-rotation.md --by operator`",
    ]);
  });

  it("names the sections a verdict restoring the recommendation revised", () => {
    const restored = {
      ...RESULT.verdicts[1],
      revised: ["§5.1"],
    } as DecideVerdictsResult["verdicts"][number];
    const lines = renderVerdictsReport({ ...RESULT, verdicts: [restored], open: [] });

    expect(lines[0]).toBe("q-scope    per-run   (recommended) — revised: §5.1");
  });

  it("omits the diff block when the body did not change", () => {
    const lines = renderVerdictsReport({ ...RESULT, diff: "" });

    expect(lines.some((l) => l.startsWith("---"))).toBe(false);
  });
});

describe("verdictsReportJson", () => {
  it("holds exactly the report keys, with no $schema", () => {
    const report = verdictsReportJson(RESULT) as unknown as Record<string, unknown>;

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
