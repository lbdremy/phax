import { describe, expect, it } from "vitest";
import {
  buildResumeInstructions,
  type ResumeInstructionsInput,
} from "../../src/app/resumeInstructions.js";

const NOW = new Date("2026-06-19T12:00:00.000Z");
const FUTURE_RESET = "2026-06-19T13:00:00.000Z";

const BASE: ResumeInstructionsInput = {
  runPath: "/runs/my-run",
  shortName: "my-run",
  reason: "Rate limit",
  now: NOW,
  platform: "darwin",
};

describe("buildResumeInstructions — limit variant", () => {
  it("contains caffeinate command for darwin when resetAt is in the future", () => {
    const md = buildResumeInstructions({ ...BASE, resetAt: FUTURE_RESET });
    expect(md).toContain("caffeinate -i");
    expect(md).toContain("phax resume my-run --yes --verbose");
  });

  it("contains systemd-inhibit command for linux", () => {
    const md = buildResumeInstructions({
      ...BASE,
      platform: "linux",
      resetAt: FUTURE_RESET,
    });
    expect(md).toContain("systemd-inhibit --what=idle:sleep");
    expect(md).toContain("phax resume my-run --yes --verbose");
  });

  it("falls back to plain resume command when resetAt is absent", () => {
    const md = buildResumeInstructions({ ...BASE, resetAt: undefined });
    expect(md).toContain("phax resume my-run --yes --verbose");
    expect(md).not.toContain("caffeinate");
  });

  it("includes enter-phase step when phaseId is present", () => {
    const md = buildResumeInstructions({ ...BASE, phaseId: "phase-02" });
    expect(md).toContain("phax enter-phase my-run phase-02");
  });

  it("preserves the Why it stopped section", () => {
    const md = buildResumeInstructions({ ...BASE, resetAt: FUTURE_RESET });
    expect(md).toContain("## Why it stopped");
    expect(md).toContain("Rate limit");
  });

  it("appends the raw message when present", () => {
    const md = buildResumeInstructions({ ...BASE, rawMessage: "quota exceeded" });
    expect(md).toContain("quota exceeded");
  });
});

describe("buildResumeInstructions — gates_exhausted variant", () => {
  const gateBase: ResumeInstructionsInput = {
    ...BASE,
    kind: "gates_exhausted",
    reason: "Gate attempts exhausted",
    phaseId: "phase-03",
  };

  it("contains enter-phase command", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("phax enter-phase my-run phase-03");
  });

  it("contains resume command", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("phax resume my-run --yes");
  });

  it("contains reset-phase command", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("phax reset-phase my-run phase-03");
  });

  it("preserves the Why it stopped section", () => {
    const md = buildResumeInstructions(gateBase);
    expect(md).toContain("## Why it stopped");
  });

  it("uses placeholder when phaseId is absent", () => {
    const md = buildResumeInstructions({ ...gateBase, phaseId: undefined });
    expect(md).toContain("<phase-id>");
  });
});

describe("buildResumeInstructions — oracle step stops", () => {
  const exhausted: ResumeInstructionsInput = {
    ...BASE,
    shortName: "refunds",
    kind: "gates_exhausted",
    reason: "Gate checks failed",
    phaseId: "phase-03",
  };
  const refused: ResumeInstructionsInput = {
    ...exhausted,
    kind: "gate_refused",
    reason: "Gate step refused",
    refusal: { command: "node tools/oracle.mjs", reason: "r", remedy: "m" },
  };

  it("an oracle exhaustion names --skip-oracle and the configured gate", () => {
    const md = buildResumeInstructions({ ...exhausted, failedStep: "oracle" });
    expect(md).toContain(
      "This run paused because the oracle step failed after exhausting all fix attempts.",
    );
    expect(md).toContain("resume with --skip-oracle: the phase's configured gate still runs");
    expect(md).toContain("phax resume refunds --yes --skip-oracle");
    expect(md).not.toContain("reset-phase");
  });

  it("an oracle refusal names --skip-oracle and the configured gate", () => {
    const md = buildResumeInstructions({ ...refused, failedStep: "oracle" });
    expect(md).toContain("refused to run");
    expect(md).toContain("resume with --skip-oracle: the phase's configured gate still runs");
    // One paragraph names both ways on; the resume advice is not repeated.
    expect(md).not.toContain("Either resume as is");
    expect(md.split("No fix attempt was made.")).toHaveLength(2);
    expect(md).toContain("phax resume refunds --yes --skip-oracle");
  });

  it("a configured step names no --skip-oracle", () => {
    for (const input of [exhausted, refused]) {
      expect(buildResumeInstructions({ ...input, failedStep: "configured" })).not.toContain(
        "--skip-oracle",
      );
      expect(buildResumeInstructions(input)).not.toContain("--skip-oracle");
    }
  });
});

describe("buildResumeInstructions — protected paths", () => {
  const baseline = {
    path: "packages/a/steme.baseline.json",
    kind: "edited",
    entry: "protectedPaths[0]",
    glob: "**/steme.baseline.json",
  } as const;
  const exhausted: ResumeInstructionsInput = {
    ...BASE,
    kind: "gates_exhausted",
    reason: "Gate checks failed",
    phaseId: "phase-02",
    failedStep: "protected-paths",
    protectedChanges: [baseline],
    lastFixTranscript: "/runs/my-run/phase-02/fix-attempt-03.jsonl",
  };

  it("names each path with its kind, says no phase may change it and points to the last fix transcript", () => {
    const md = buildResumeInstructions(exhausted);
    expect(md).toContain(
      "- packages/a/steme.baseline.json — edited (protectedPaths[0] **/steme.baseline.json)",
    );
    expect(md).toContain("No phase of this run may change these paths");
    expect(md).toContain("/runs/my-run/phase-02/fix-attempt-03.jsonl");
  });

  it("gives the two ways on and never offers a phase reset", () => {
    const md = buildResumeInstructions(exhausted);
    expect(md).toContain("phax resume my-run --yes");
    expect(md).toContain("make it on the base branch yourself and start a new run");
    expect(md).not.toContain("reset-phase");
  });

  it("says when no fix attempt was made", () => {
    const md = buildResumeInstructions({ ...exhausted, lastFixTranscript: null });
    expect(md).toContain("No fix attempt was made.");
  });

  it("lists the paths of a failed step too, keeping the step's own opening", () => {
    const md = buildResumeInstructions({ ...exhausted, failedStep: "configured" });
    expect(md).toContain("its gate checks failed after exhausting all fix attempts");
    expect(md).toContain("## Protected paths changed");
  });

  it("lists both the refused step and the protected paths for a refusal", () => {
    const md = buildResumeInstructions({
      ...BASE,
      shortName: "my-run",
      kind: "gate_refused",
      reason: "Gate step refused",
      phaseId: "phase-02",
      failedStep: "configured",
      refusal: {
        command: "node ./audit.mjs",
        reason: "needs hw-rules 2",
        remedy: "pnpm add hw-rules@2",
      },
      protectedChanges: [baseline],
    });
    expect(md).toContain("the gate step `node ./audit.mjs` refused to run");
    expect(md).toContain("packages/a/steme.baseline.json — edited");
    expect(md).toContain("No phase of this run may change these paths");
    expect(md).not.toContain("reset-phase");
  });

  it("names the phase base by its hash and gives the command putting each path back", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const md = buildResumeInstructions({
      ...exhausted,
      protectedChanges: [
        baseline,
        { ...baseline, path: "packages/b/it's.json", kind: "created" },
        { ...baseline, path: "packages/c/steme.baseline.json", kind: "deleted" },
        { ...baseline, path: "packages/d/steme.baseline.json", kind: "renamed" },
      ],
      protectedRestore: { commit, name: "phase base" },
    });
    expect(md).toContain(`Compared with the phase base, commit ${commit}:`);
    expect(md).toContain(
      [
        "To put each path back to its content at the phase base, run in the phase worktree:",
        "",
        "```bash",
        `git checkout ${commit} -- 'packages/a/steme.baseline.json'`,
        `rm -- 'packages/b/it'\\''s.json'`,
        `git checkout ${commit} -- 'packages/c/steme.baseline.json'`,
        `if git cat-file -e '${commit}:packages/d/steme.baseline.json' 2>/dev/null; then git checkout ${commit} -- 'packages/d/steme.baseline.json'; else rm -- 'packages/d/steme.baseline.json'; fi`,
        "```",
      ].join("\n"),
    );
  });

  it("removes a symbolic link or a nested repository and checks out what the base held there", () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const md = buildResumeInstructions({
      ...exhausted,
      protectedChanges: [
        { ...baseline, path: "packages/e", kind: "symlink" },
        { ...baseline, path: "vendor/n", kind: "nested-repository" },
      ],
      protectedRestore: { commit, name: "phase base" },
    });
    expect(md).toContain(
      `rm -rf -- 'packages/e'; if git cat-file -e '${commit}:packages/e' 2>/dev/null; then git checkout ${commit} -- 'packages/e'; fi`,
    );
    expect(md).toContain(
      "- vendor/n — nested-repository (protectedPaths[0] **/steme.baseline.json)",
    );
  });

  it("names the phase commit after a handoff pause", () => {
    const commit = "89abcdef0123456789abcdef0123456789abcdef";
    const md = buildResumeInstructions({
      ...BASE,
      kind: "protected_paths_changed",
      reason: "Protected paths changed after the commit",
      phaseId: "phase-02",
      protectedChanges: [baseline],
      protectedRestore: { commit, name: "phase commit" },
    });
    expect(md).toContain(`Compared with the phase commit, commit ${commit}:`);
    expect(md).toContain(`git checkout ${commit} -- 'packages/a/steme.baseline.json'`);
  });

  it("is today's instructions with no change", () => {
    const md = buildResumeInstructions({
      ...BASE,
      kind: "gates_exhausted",
      phaseId: "phase-02",
      failedStep: "configured",
      protectedChanges: [],
      lastFixTranscript: null,
    });
    expect(md).not.toContain("Protected paths");
    expect(md).toContain("phax reset-phase my-run phase-02");
  });
});

describe("buildResumeInstructions — gate_refused variant", () => {
  const refusedBase: ResumeInstructionsInput = {
    ...BASE,
    shortName: "hello-world.greet",
    kind: "gate_refused",
    reason: "Gate step refused",
    phaseId: "phase-01",
    worktreePath: "/worktrees/hello-world.greet/phase-01",
    refusal: {
      command: "node ./audit.mjs",
      reason: "the checks need hw-rules 2, and 1 is installed",
      remedy: "pnpm add -D hw-rules@2",
    },
  };

  it("says the step refused, with its reason and its remedy", () => {
    const md = buildResumeInstructions(refusedBase);
    expect(md).toContain("the gate step `node ./audit.mjs` refused to run");
    expect(md).toContain("the checks need hw-rules 2, and 1 is installed");
    expect(md).toContain("pnpm add -D hw-rules@2");
  });

  it("says no fix attempt was made", () => {
    expect(buildResumeInstructions(refusedBase)).toContain("No fix attempt was made.");
  });

  it("ends with phax resume <short name>", () => {
    const md = buildResumeInstructions(refusedBase);
    expect(md.trimEnd().endsWith("phax resume hello-world.greet --yes\n```")).toBe(true);
    expect(md).not.toContain("reset-phase");
  });
});
