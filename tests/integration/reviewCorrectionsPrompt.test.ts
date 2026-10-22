import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readPreviousHandoff,
  readPreviousReconciliation,
  readReviewCorrections,
} from "../../src/app/handoffInjection.js";
import { buildPhasePrompt } from "../../src/app/promptGeneration.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import type { FileSystem } from "../../src/ports/fs.js";
import type { PhaxPlan, PhaxPlanPhase } from "../../src/schemas/phaxPlan.js";
import type { PhaseStatus } from "../../src/schemas/status.js";
import { phaseStatus } from "../helpers/phaseStatusFixture.js";
import { phaseReconciliationFile } from "../helpers/reconciliationFixture.js";
import { removeTempDir } from "../helpers/tempGit.js";

// The made-up credit-notes run: six phases, phase-03 and phase-05 declared
// interactive and both closed corrected, read from a real run folder by the
// lookups executePlan builds every later prompt from.

const INTERACTIVE = new Set(["phase-03", "phase-05"]);

const phases: readonly PhaxPlanPhase[] = Array.from({ length: 6 }, (_, i) => {
  const id = `phase-0${i + 1}`;
  return {
    id,
    title: `Credit notes ${i + 1}`,
    model: "claude-sonnet-5-5",
    effort: "medium",
    planMarkdownAnchor: `#${id}`,
    plannedFilesToCreate: INTERACTIVE.has(id) ? [] : [`src/credit/${id}.ts`],
    plannedFilesToEdit: [],
    optionalFilesToEdit: [],
    mode: INTERACTIVE.has(id) ? "interactive" : "headless",
    oracle: null,
    commit: { subject: `feat(credit): step ${i + 1}`, body: "Made-up body." },
  };
});

const plan = {
  run: {
    shortName: "credit-notes",
    title: "Credit notes",
    branch: "phax/credit-notes",
    requiredCommands: [],
  },
  phases: phases as PhaxPlan["phases"],
} satisfies PhaxPlan;

const CHANGED: Readonly<Record<string, readonly string[]>> = {
  "phase-03": ["src/credit/labels.ts", "src/credit/phase-02.ts"],
  "phase-05": ["src/credit/phase-04.ts"],
};

let runPath: string;
let statuses: PhaseStatus[];

const provided = <A, E>(effect: Effect.Effect<A, E, FileSystem>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeFileSystemLayer)));

function write(phaseId: string, file: string, content: string): void {
  mkdirSync(join(runPath, phaseId), { recursive: true });
  writeFileSync(join(runPath, phaseId, file), content);
}

beforeEach(() => {
  runPath = join(
    realpathSync(mkdtempSync(join(tmpdir(), "phax-review-corrections-test-"))),
    "credit-notes",
  );
  statuses = [];
  for (const [index, phase] of phases.entries()) {
    const interactive = phase.mode === "interactive";
    statuses.push(
      phaseStatus({
        phaseId: phase.id,
        phaseIndex: index,
        state: "cleaned_up",
        model: phase.model,
        effort: phase.effort,
        branchName: `phax/credit-notes--${phase.id}`,
        base: "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
        createdAt: "2026-10-22T09:00:00.000Z",
        updatedAt: "2026-10-22T09:00:00.000Z",
        mode: phase.mode,
        stop: interactive ? { cause: "declared", status: "closed", outcome: "corrected" } : null,
      }),
    );
    write(
      phase.id,
      "phase-handoff.md",
      interactive
        ? `## What was corrected\n- Correction made at ${phase.id}.\n`
        : `## What was delivered\n- ${phase.id} delivered.\n`,
    );
    write(
      phase.id,
      "file-reconciliation.md",
      `## PHAX File Reconciliation\n\n${phase.id} files.\n`,
    );
    write(
      phase.id,
      "file-reconciliation.json",
      JSON.stringify(
        phaseReconciliationFile(
          phase.id,
          interactive ? { reviewCorrections: [...(CHANGED[phase.id] ?? [])] } : {},
        ),
      ),
    );
  }
});

afterEach(() => {
  removeTempDir(join(runPath, ".."));
});

async function promptFor(phaseIndex: number): Promise<string> {
  const phase = phases[phaseIndex]!;
  return buildPhasePrompt({
    planPreamble: "# Credit notes",
    phaseSection: `## ${phase.id} — ${phase.title}`,
    plan,
    currentPhase: phase,
    previousHandoff: await provided(readPreviousHandoff(runPath, phases, phaseIndex)),
    previousReconciliation: await provided(readPreviousReconciliation(runPath, phases, phaseIndex)),
    reviewCorrections: await provided(readReviewCorrections(runPath, phases, phaseIndex, statuses)),
    gateCommands: ["pnpm test"],
    oracleRole: null,
  });
}

describe("later prompts after two closed stops", () => {
  it("phase-06 reads phase-03's correction, then phase-05's, with their files", async () => {
    const prompt = await promptFor(5);

    const section = prompt.slice(
      prompt.indexOf("## Review corrections"),
      prompt.indexOf("## Previous phase file reconciliation"),
    );
    expect(section).toContain(
      "A person reviewed and corrected the run at phase-03 and phase-05. Where this section disagrees with an earlier phase's handoff, this section wins. Your own plan section still binds.",
    );
    const at03 = section.indexOf("### phase-03 (interactive)");
    const at05 = section.indexOf("### phase-05 (interactive)");
    expect(at03).toBeGreaterThan(0);
    expect(at05).toBeGreaterThan(at03);
    expect(section.slice(at03, at05)).toContain("- Correction made at phase-03.");
    expect(section.slice(at03, at05)).toContain("- src/credit/labels.ts\n- src/credit/phase-02.ts");
    expect(section.slice(at05)).toContain("- Correction made at phase-05.");
    expect(section.slice(at05)).toContain("- src/credit/phase-04.ts");
  });

  it("the previous handoff and reconciliation skip back to the nearest headless phase", async () => {
    const at06 = await promptFor(5);
    const handoff06 = at06.slice(
      at06.indexOf("## Previous phase handoff"),
      at06.indexOf("## Review corrections"),
    );
    expect(handoff06).toContain("- phase-04 delivered.");
    expect(handoff06).not.toContain("Correction made");
    expect(at06).toContain("phase-04 files.");
    expect(at06).not.toContain("phase-05 files.");

    const at04 = await promptFor(3);
    expect(at04).toContain("- phase-02 delivered.");
    expect(at04).toContain("phase-02 files.");
    expect(at04).toContain("### phase-03 (interactive)");
    expect(at04).not.toContain("### phase-05 (interactive)");
  });

  it("a stop still waiting, and every phase before the first stop, read no section", async () => {
    statuses = statuses.map((s) =>
      s.phaseId === "phase-05" ? { ...s, stop: { cause: "declared", status: "waiting" } } : s,
    );
    const at06 = await promptFor(5);
    expect(at06).toContain("### phase-03 (interactive)");
    expect(at06).not.toContain("### phase-05 (interactive)");
    expect(at06).toContain("A person reviewed and corrected the run at phase-03.");

    expect(await promptFor(1)).not.toContain("## Review corrections");
  });
});
