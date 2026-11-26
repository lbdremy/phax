import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  renderFindingDefer,
  renderFindingDismiss,
  renderFindingFix,
  renderFindingList,
  renderFindingPost,
  type FindingFixOutput,
} from "../../src/cli/definitions/finding.js";
import { renderFateComment } from "../../src/domain/findings/fateComment.js";
import { renderPrFindingsSection } from "../../src/domain/publish/prFindings.js";
import type { FindingListFile } from "../../src/schemas/findingList.js";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";

// The terminal and pull-request examples of docs/findings.md are rendered here from phax's own
// renderers, over the page's example run `gate-retry`: an example that drifts from the real
// output fails. Each rendered example must appear on the page as a whole ```text block.
const PAGE = readFileSync(new URL("../../docs/findings.md", import.meta.url), "utf8");

const textBlock = (text: string): string => "```text\n" + text + "\n```";

type Finding = FindingListFile["findings"][number];
type Entry = Finding["history"][number];

const at = "2026-11-18T10:00:00.000Z";
const ada = { kind: "operator", name: "Ada Lovelace" } as const;
const F1_FIX = "8c1d2e4f".padEnd(40, "0");
const F2_FIX = "3fa91c2b".padEnd(40, "0");
const PR = "https://github.com/acme/shop/pull/42";

const fixedBy = (commit: string, pathClasses: Extract<Entry, { fate: "fixed" }>["pathClasses"]) =>
  ({ fate: "fixed", commit, pathClasses, by: ada, at }) as const;
const dismissedFor = (why: string): Entry => ({
  fate: "dismissed",
  verdict: {
    kind: "decided",
    chosen: "dismiss",
    abandoned: ["fix", "defer"],
    why,
    advocate: "Name the new flag.",
    principles: [],
    reversibility: "cheap",
    by: ada,
    at,
    revised: [],
  },
});
const deferredTo = (to: string): Entry => ({
  fate: "deferred",
  to,
  why: "needs its own plan",
  by: ada,
  at,
});

const code = (
  id: string,
  severity: "bug" | "concern" | "info",
  file: string,
  line: number,
  message: string,
  history: readonly Entry[],
): Finding => ({
  id,
  source: "code-review",
  severity,
  file,
  line,
  message,
  lens: "core",
  escape: "omission",
  criterion: null,
  suggestion: "…",
  fate: history.at(-1)?.fate ?? "open",
  history,
  landed: null,
});

// A fix whose recorded commit is on main: the list shows nothing more on its line.
const onMain = (commit: string) =>
  ({ status: "found", by: "recorded", commit, branch: "main", recorded: commit }) as const;

const F1: Finding = {
  ...code("F1", "bug", "src/app/retry.ts", 41, "The retry count is never reset after a pass", [
    fixedBy(F1_FIX, ["code", "tests"]),
  ]),
  landed: onMain(F1_FIX),
};
const F2 = code("F2", "concern", "src/app/retry.ts", 77, "The backoff has no upper bound", []);
const F3 = code("F3", "info", "docs/retry.md", 9, "The page still names the old flag", [
  dismissedFor("the page names it on purpose"),
]);
const F4 = code("F4", "concern", "src/gate.ts", 12, "The gate reads the config twice", [
  deferredTo("NEXT_STEPS.md"),
]);
const C1: Finding = {
  id: "C1",
  source: "compliance-review",
  severity: "deviation",
  phaseId: "phase-02",
  dimension: "files",
  message: "src/gate.ts was edited and not planned",
  fate: "open",
  history: [],
  landed: null,
};
const F2_FIXED: Finding = {
  ...F2,
  fate: "fixed",
  history: [fixedBy(F2_FIX, ["tests"])],
  landed: onMain(F2_FIX),
};

const run = {
  namespace: "acme",
  shortName: "gate-retry",
  runId: "gate-retry-1",
  state: "review_open",
  baseBranch: "main",
} as const;

const pushed = { remote: "origin", branch: "phax/gate-retry--phase-03", sha: F2_FIX } as const;
const commentsOn = (...ids: readonly string[]) =>
  ids.map((finding, index) => ({ finding, url: `${PR}#issuecomment-${index + 1}` }));

const fixAnswer = (pullRequest: FindingFixOutput["pullRequest"]): FindingFixOutput => ({
  run,
  commit: {
    sha: F2_FIX,
    made: true,
    subject: "fix(review): F2 of gate-retry",
    paths: [{ path: "tests/gate.test.ts", pathClass: "tests" }],
    followed: null,
  },
  recorded: [{ finding: "F2", key: "gate-retry-1/finding/F2/01", recordCommit: "a".repeat(40) }],
  findings: [F2_FIXED],
  pullRequest,
});

// "When the fix commit is rewritten": F2's commit was recreated on main; F4, fixed after its
// deferral, was then squashed away.
const F2_REWRITE = "8b04d6e1".padEnd(40, "0");
const F4_FIX = "5e17c0d9".padEnd(40, "0");
const RUN_BRANCH = "phax/gate-retry--phase-03";

const F2_REWRITTEN: Finding = {
  ...F2_FIXED,
  landed: { status: "found", by: "key", commit: F2_REWRITE, branch: "main", recorded: F2_FIX },
};
const F4_LOST: Finding = {
  ...F4,
  fate: "fixed",
  history: [...F4.history, fixedBy(F4_FIX, ["code"])],
  landed: { status: "not-found", branches: ["main", RUN_BRANCH], recorded: F4_FIX },
};

const settled = (finding: Finding): FindingFixOutput => ({
  run,
  commit: null,
  recorded: [],
  findings: [finding],
  pullRequest: { kind: "not-posted", reason: "publish-auto-off" },
});

describe("docs/findings.md examples", () => {
  it("shows phax finding list as it renders", () => {
    const list: FindingListFile = {
      $schema: currentSchemaUrl("finding-list"),
      run,
      records: "read",
      findings: [F1, F2, F3, F4, C1],
    };
    expect(PAGE).toContain(textBlock(renderFindingList(list)));
  });

  it("shows phax finding fix as it renders, with and without the pull request", () => {
    expect(PAGE).toContain(
      textBlock(renderFindingFix(fixAnswer({ kind: "not-posted", reason: "publish-auto-off" }))),
    );
    expect(PAGE).toContain(
      textBlock(
        renderFindingFix(
          fixAnswer({ kind: "posted", url: PR, pushed, comments: commentsOn("F2") }),
        ),
      ),
    );
    expect(PAGE).toContain(
      textBlock(renderFindingFix(fixAnswer({ kind: "not-posted", reason: "pull-request-merged" }))),
    );
  });

  it("shows phax finding dismiss and defer as they render", () => {
    expect(PAGE).toContain(
      textBlock([renderFindingDismiss(settled(F3)), renderFindingDefer(settled(F4))].join("\n")),
    );
  });

  it("shows phax finding post as it renders", () => {
    const answer = {
      run,
      pullRequest: { url: PR, pushed, comments: commentsOn("F2", "F3") },
      pullRequestState: "open" as const,
      findings: [F2_FIXED, F3],
    };
    expect(PAGE).toContain(textBlock(renderFindingPost(answer)));
  });

  it("shows the description's Review findings section as it renders", () => {
    const section = renderPrFindingsSection(
      { kind: "read", records: "read", findings: [F1, F2, F3, F4, C1] },
      { open: 50, deferred: 50 },
      "gate-retry",
    );
    expect(PAGE).toContain(textBlock(section));
  });

  it("shows where rewritten fixes landed in the list", () => {
    const list: FindingListFile = {
      $schema: currentSchemaUrl("finding-list"),
      run,
      records: "read",
      findings: [F1, F2_REWRITTEN, F3, F4_LOST, C1],
    };
    expect(PAGE).toContain(textBlock(renderFindingList(list)));
  });

  it("shows a followed --commit as it renders", () => {
    const answer: FindingFixOutput = {
      ...fixAnswer({ kind: "not-posted", reason: "pull-request-merged" }),
      commit: {
        sha: F2_REWRITE,
        made: false,
        subject: null,
        paths: [{ path: "tests/gate.test.ts", pathClass: "tests" }],
        followed: {
          named: F2_FIX,
          notOn: [RUN_BRANCH, "main"],
          matches: [{ finding: "F2", by: "key" }],
          branch: "main",
        },
      },
      findings: [F2_REWRITTEN],
    };
    expect(PAGE).toContain(textBlock(renderFindingFix(answer)));
  });

  it("shows a post on a merged pull request as it renders", () => {
    const answer = {
      run,
      pullRequest: { url: PR, pushed: null, comments: commentsOn("F2") },
      pullRequestState: "merged" as const,
      findings: [F2_REWRITTEN],
    };
    expect(PAGE).toContain(textBlock(renderFindingPost(answer)));
  });

  it("shows each fate comment as it renders", () => {
    for (const finding of [F2_FIXED, F3, F4, F2_REWRITTEN, F4_LOST]) {
      const comment = renderFateComment(finding, run.runId);
      expect(comment, finding.id).not.toBeNull();
      expect(PAGE, finding.id).toContain(textBlock(comment as string));
    }
  });
});
