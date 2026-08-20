import { describe, expect, it } from "vitest";
import { decideRecordsDestination } from "../../src/domain/records/destination.js";
import type { RecordsDestination } from "../../src/schemas/recordsConfig.js";

const IN_REPO: RecordsDestination = { kind: "in-repo" };
const IN_REPO_ACKNOWLEDGED: RecordsDestination = {
  kind: "in-repo",
  acknowledgedUnknownVisibility: true,
};
const REPO: RecordsDestination = { kind: "repo", remote: "https://example.com/records.git" };

describe("decideRecordsDestination", () => {
  it("allows a private source repo with transcripts on and an in-repo destination", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO,
      visibility: "private",
    });
    expect(decision).toEqual({ kind: "allowed", destination: IN_REPO });
  });

  it("refuses a public source repo with transcripts on and an in-repo destination, naming the destination", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO,
      visibility: "public",
    });
    expect(decision.kind).toBe("refused");
    if (decision.kind === "refused") {
      expect(decision.reason).toBe("public-source-in-repo");
      expect(decision.destination).toEqual(IN_REPO);
      expect(decision.message).toContain("public");
      expect(decision.remedy.length).toBeGreaterThan(0);
    }
  });

  it("allows a public source repo with transcripts off and an in-repo destination", () => {
    const decision = decideRecordsDestination({
      transcript: false,
      destination: IN_REPO,
      visibility: "public",
    });
    expect(decision).toEqual({ kind: "allowed", destination: IN_REPO });
  });

  it("refuses an unknown-visibility source repo with transcripts on and no acknowledgement", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO,
      visibility: "unknown",
    });
    expect(decision.kind).toBe("refused");
    if (decision.kind === "refused") {
      expect(decision.reason).toBe("unacknowledged-unknown-visibility");
    }
  });

  it("allows an unknown-visibility source repo with transcripts on once acknowledged", () => {
    const decision = decideRecordsDestination({
      transcript: true,
      destination: IN_REPO_ACKNOWLEDGED,
      visibility: "unknown",
    });
    expect(decision).toEqual({ kind: "allowed", destination: IN_REPO_ACKNOWLEDGED });
  });

  it("allows a dedicated destination whatever the visibility", () => {
    for (const visibility of ["public", "private", "unknown"] as const) {
      const decision = decideRecordsDestination({
        transcript: true,
        destination: REPO,
        visibility,
      });
      expect(decision).toEqual({ kind: "allowed", destination: REPO });
    }
  });
});
