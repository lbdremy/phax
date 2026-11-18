/**
 * `phax plans status` in a process repository that links its code repository (spec
 * code-repository, acceptance criteria for staleness under the link). Each test is an acceptance
 * test frozen before its code exists: it is marked `it.fails` and fails today on its own
 * assertion. The phase that implements staleness under the link removes the markers.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { approvalRecordPathFor } from "../../src/domain/artifact/approvalRecordFile.js";
import { artifactFingerprint } from "../../src/app/approvalRecordStore.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { createLinkedProject, type LinkedProject } from "../fixtures/codeLink/linkedProject.js";

const FOOTPRINT = "src/export/csv.ts";

let project: LinkedProject | undefined;

afterEach(() => {
  project?.dispose();
  project = undefined;
});

function linked(opts?: Parameters<typeof createLinkedProject>[0]): LinkedProject {
  project = createLinkedProject(opts);
  return project;
}

function entryOf(
  json: NonNullable<Awaited<ReturnType<LinkedProject["plansStatus"]>>["json"]>,
  path: string,
) {
  const entry = json.report.find((e) => e.path === path);
  if (entry === undefined) throw new Error(`no report entry for ${path}`);
  return entry.result;
}

describe("plans status under the code link", { timeout: 60_000 }, () => {
  it.fails("a code change in the footprint makes the plan stale (ac-code-change-stale)", async () => {
    const p = linked();
    const plan = p.writePlan("export", { edits: [FOOTPRINT], sourceSpec: null });
    await p.approve(plan);
    const baseline = p.codeHead();
    p.commitInCode(FOOTPRINT, "export const csv = 2;\n");

    const json = await p.plansStatus(["--json"]);
    const result = entryOf(json.json!, plan);
    expect(result.kind).toBe("stale");
    const ground = result.evidence?.find((e) => e.reason === "ground-changed");
    expect(ground?.files).toContain(FOOTPRINT);
    expect(ground?.baseline).toBe(baseline);
    expect(ground?.codeRoot).toBe("code");

    const text = await p.plansStatus([]);
    expect(text.stdout).toContain(`${FOOTPRINT} changed in code/ since baseline ${baseline}`);

    const applied = await p.plansStatus(["--apply"]);
    expect(applied.code).toBe(0);
    expect(readFileSync(join(p.processRepo, plan), "utf8")).toContain("status: Stale");
  });

  it.fails("a process-repository change at a footprint path is not ground (ac-process-change-not-ground)", async () => {
    const p = linked();
    const plan = p.writePlan("export", { edits: [FOOTPRINT], sourceSpec: null });
    await p.approve(plan);
    p.commitInProcess(FOOTPRINT, "process tree file\n");

    const json = await p.plansStatus(["--json"]);
    expect(entryOf(json.json!, plan).kind).toBe("fresh");
  });

  it.fails("a vanished code baseline is missing-record (ac-code-baseline-gone)", async () => {
    const p = linked();
    p.commitInCode("src/extra.ts", "export const extra = 1;\n");
    const plan = p.writePlan("export", { edits: [FOOTPRINT], sourceSpec: null });
    await p.approve(plan);
    const baseline = p.codeHead();
    p.dropCodeCommit(baseline);

    const json = await p.plansStatus(["--json"]);
    const result = entryOf(json.json!, plan);
    expect(result.kind).toBe("missing-record");
    expect(result.detail).toContain(baseline);
    expect(result.detail).toContain("code/");

    const text = await p.plansStatus([]);
    expect(text.stdout).toContain(`re-approve with "phax artifact approve ${plan}"`);
  });

  describe("a plan approved before the link (ac-prelink-record)", () => {
    it.fails("with a null-code record is missing-record", async () => {
      const p = linked({ link: false });
      const plan = p.writePlan("export", { edits: [FOOTPRINT], sourceSpec: null });
      await p.approve(plan);
      p.setLink("code");

      const json = await p.plansStatus(["--json"]);
      const result = entryOf(json.json!, plan);
      expect(result.kind).toBe("missing-record");
      expect(result.detail).toContain("without a code baseline");
    });

    it.fails("with a 0.25.0 record is missing-record", async () => {
      const p = linked();
      const plan = p.writePlan("export", { edits: [FOOTPRINT], sourceSpec: null });
      const approvedMd = readFileSync(join(p.processRepo, plan), "utf8").replace(
        "status: Draft",
        "status: Approved",
      );
      writeFileSync(join(p.processRepo, plan), approvedMd);
      const recordPath = approvalRecordPathFor("plan", plan);
      if (recordPath === null) throw new Error("no record path");
      const baseline = p.commitInProcess("notes.md", "notes\n");
      const record = {
        $schema: schemaUrl("plan-approval-record", "0.25.0"),
        artifact: plan,
        planFingerprint: artifactFingerprint(approvedMd),
        approvedAt: "2026-11-18T10:00:00.000Z",
        baseline,
        sourceSpec: null,
        approvedBy: { kind: "operator", name: "Ada Example" },
      };
      const abs = join(p.processRepo, recordPath);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, JSON.stringify(record, null, 2) + "\n");
      p.commitInProcess("approved.txt", "approved\n");

      const json = await p.plansStatus(["--json"]);
      const result = entryOf(json.json!, plan);
      expect(result.kind).toBe("missing-record");
      expect(result.detail).toContain("without a code baseline");
    });
  });

  it.fails("a code baseline without a link is missing-record (ac-unlinked-code-record)", async () => {
    const p = linked();
    const plan = p.writePlan("export", { edits: [FOOTPRINT], sourceSpec: null });
    await p.approve(plan);
    p.setLink(null);

    const json = await p.plansStatus(["--json"]);
    const result = entryOf(json.json!, plan);
    expect(result.kind).toBe("missing-record");
    expect(result.detail).toContain("declares no code link");
  });

  it.fails("a code root no longer ignored makes each Approved plan an error (ac-root-not-ignored)", async () => {
    const p = linked();
    const first = p.writePlan("export", { edits: [FOOTPRINT], sourceSpec: null });
    const second = p.writePlan("other", { edits: ["src/other.ts"], sourceSpec: null });
    await p.approve(first);
    await p.approve(second);
    p.setIgnored(false);

    const status = await p.plansStatus(["--json"]);
    expect(status.code).toBe(0);
    for (const plan of [first, second]) {
      const result = entryOf(status.json!, plan);
      expect(result.kind).toBe("error");
      expect(result.message).toContain("not ignored");
      expect(result.message).toContain("/code/");
    }
  });
});
