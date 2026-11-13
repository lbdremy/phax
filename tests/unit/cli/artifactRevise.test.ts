import { describe, expect, it } from "vitest";
import {
  renderReviseReport,
  type ReviseReport,
} from "../../../src/cli/definitions/artifactRevise.js";

const PATH = "docs/plans/2610250930-log-rotation-plan.md";

const base: ReviseReport = {
  artifact: PATH,
  status: "Draft",
  session: "new",
  provider: "claude-code",
  model: "claude-sonnet-5-5",
  requestedModel: "claude-sonnet-5-5",
  effort: "high",
  newQuestions: [],
  openQuestions: [],
  diff: "",
  commit: null,
  revisionId: "2610250930-log-rotation/01",
  written: [],
  record: { kind: "off" },
};

describe("renderReviseReport", () => {
  it("committed with no new question: approve only", () => {
    const lines = renderReviseReport({
      ...base,
      diff: "-old\n+new\n",
      commit: { hash: "abcdef1234567", subject: "docs(plan): revise log-rotation" },
    });
    expect(lines).toEqual([
      "questions  none new",
      "--- body diff ---",
      "-old\n+new",
      "commit     abcdef1 — docs(plan): revise log-rotation",
      `status     Draft — read the diff above, then \`phax artifact approve ${PATH}\``,
      "record     off",
    ]);
  });

  it("committed with a new open question: decide, then approve", () => {
    const lines = renderReviseReport({
      ...base,
      newQuestions: [{ id: "Q9", question: "Keep rotated logs?" }],
      openQuestions: ["Q9"],
      diff: "+new\n",
      commit: { hash: "abcdef1234567", subject: "docs(plan): revise log-rotation" },
    });
    expect(lines[0]).toBe("questions  1 new open: Q9 — Keep rotated logs?");
    expect(lines).toContain(
      `status     Draft — read the diff above, then \`phax artifact decide ${PATH}\` (Q9 open), then \`phax artifact approve ${PATH}\``,
    );
  });

  it("committed with a question still open from before: decide names it, then approve", () => {
    const lines = renderReviseReport({
      ...base,
      openQuestions: ["Q2"],
      diff: "-old\n+new\n",
      commit: { hash: "abcdef1234567", subject: "docs(plan): revise log-rotation" },
    });
    expect(lines[0]).toBe("questions  none new");
    expect(lines).toContain(
      `status     Draft — read the diff above, then \`phax artifact decide ${PATH}\` (Q2 open), then \`phax artifact approve ${PATH}\``,
    );
  });

  it("names the questions it appended first, then the ones open before", () => {
    const lines = renderReviseReport({
      ...base,
      newQuestions: [{ id: "Q9", question: "Keep rotated logs?" }],
      openQuestions: ["Q1", "Q2", "Q9"],
      diff: "+new\n",
      commit: { hash: "abcdef1234567", subject: "docs(plan): revise log-rotation" },
    });
    expect(lines).toContain(
      `status     Draft — read the diff above, then \`phax artifact decide ${PATH}\` (Q9, Q1, Q2 open), then \`phax artifact approve ${PATH}\``,
    );
  });

  it("unchanged: says so, with no diff and no commit line", () => {
    const lines = renderReviseReport(base);
    expect(lines).toContain(
      `nothing changed: the amendment changed nothing in ${PATH} — no commit`,
    );
    expect(lines.some((l) => l.startsWith("commit "))).toBe(false);
    expect(lines).not.toContain("--- body diff ---");
    expect(lines).toContain(`status     Draft — unchanged; \`phax artifact approve ${PATH}\``);
    expect(lines.some((l) => l.includes("read the diff above"))).toBe(false);
  });

  it("unchanged with a question still open: unchanged, then decide and approve", () => {
    const lines = renderReviseReport({ ...base, openQuestions: ["Q2"] });
    expect(lines).toContain(
      `status     Draft — unchanged; \`phax artifact decide ${PATH}\` (Q2 open), then \`phax artifact approve ${PATH}\``,
    );
  });
});
