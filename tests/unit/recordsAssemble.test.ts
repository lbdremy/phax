import { describe, expect, it } from "vitest";
import { assembleRecord, type AssembleRecordInput } from "../../src/domain/records/assemble.js";
import { UNAVAILABLE_TOKEN_USAGE } from "../../src/schemas/runRecord.js";

const baseInput: AssembleRecordInput = {
  runId: "entire-checkpoint-spike-1786807559589",
  phaseId: "phase-01",
  files: ["prompt.md", "diff.patch", "status.json", "output.jsonl"],
  transcriptEnabled: true,
  model: "claude-sonnet-5",
  effort: "high",
  provider: "claude-code",
  outcome: "committed",
  usage: UNAVAILABLE_TOKEN_USAGE,
};

describe("assembleRecord", () => {
  it("assembles a full record when transcript is enabled and output.jsonl is present", () => {
    const { manifest, artifactPaths } = assembleRecord(baseInput);
    expect(manifest.shape).toBe("full");
    expect(artifactPaths).toContain("output.jsonl");
  });

  it("assembles a skeleton when transcript is disabled, even if output.jsonl is present", () => {
    const { manifest, artifactPaths } = assembleRecord({ ...baseInput, transcriptEnabled: false });
    expect(manifest.shape).toBe("skeleton");
    expect(artifactPaths).not.toContain("output.jsonl");
  });

  it("assembles a skeleton when the provider produced no output.jsonl, whatever the toggle", () => {
    const files = baseInput.files.filter((f) => f !== "output.jsonl");
    const { manifest, artifactPaths } = assembleRecord({
      ...baseInput,
      transcriptEnabled: true,
      files,
    });
    expect(manifest.shape).toBe("skeleton");
    expect(artifactPaths).not.toContain("output.jsonl");
  });

  it("carries every checks-attempt-NN.log from a phase that took several fix-loop attempts", () => {
    const files = [
      "prompt.md",
      "diff.patch",
      "status.json",
      "checks-attempt-01.log",
      "checks-attempt-02.log",
      "checks-attempt-03.log",
    ];
    const { artifactPaths } = assembleRecord({ ...baseInput, files, transcriptEnabled: false });
    expect(artifactPaths).toEqual([
      "checks-attempt-01.log",
      "checks-attempt-02.log",
      "checks-attempt-03.log",
      "diff.patch",
      "prompt.md",
      "status.json",
    ]);
  });

  it("records the source sha as a back-reference when the phase committed", () => {
    const { manifest } = assembleRecord({ ...baseInput, sourceSha: "a726aff" });
    expect(manifest.sourceSha).toBe("a726aff");
  });

  it("omits the source sha for a phase that ended without a commit", () => {
    const { manifest } = assembleRecord({ ...baseInput, outcome: "failed", sourceSha: undefined });
    expect(manifest.sourceSha).toBeUndefined();
  });

  it("carries the runId and phaseId as the record key", () => {
    const { manifest } = assembleRecord(baseInput);
    expect(manifest.runId).toBe(baseInput.runId);
    expect(manifest.phaseId).toBe(baseInput.phaseId);
  });

  it("carries the declared-unavailable usage through unchanged", () => {
    const { manifest } = assembleRecord(baseInput);
    expect(manifest.usage).toEqual(UNAVAILABLE_TOKEN_USAGE);
  });

  it("does not mutate the input files array", () => {
    const files = ["b.log", "a.log"];
    const frozen = Object.freeze([...files]);
    expect(() =>
      assembleRecord({ ...baseInput, files: frozen, transcriptEnabled: false }),
    ).not.toThrow();
  });
});
