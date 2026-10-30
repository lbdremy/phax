import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_REVIEW_RETRY_STREAM_FILENAME,
  COMPLIANCE_REVIEW_STREAM_FILENAME,
  complianceRefusedTwiceMessage,
  complianceRetryPrompt,
  complianceRetryWarning,
} from "../../../src/domain/review/complianceRetry.js";

describe("the compliance review's corrective resume texts", () => {
  it("keeps the retry's transcript beside the first session's", () => {
    expect(COMPLIANCE_REVIEW_STREAM_FILENAME).toBe("compliance-review.session.jsonl");
    expect(COMPLIANCE_REVIEW_RETRY_STREAM_FILENAME).toBe("compliance-review-retry.session.jsonl");
  });

  it("warns with the refusal and the single resume", () => {
    expect(complianceRetryWarning('perPhase: phase "phase-04" is not a phase of this run')).toBe(
      'compliance-review answer refused — perPhase: phase "phase-04" is not a phase of this run\n  resuming the session once to ask for the whole answer again',
    );
  });

  it("names both refusals when the retry is refused too", () => {
    expect(complianceRefusedTwiceMessage("first refusal", "second refusal")).toBe(
      "compliance-review answer rejected twice — first answer: first refusal; retry: second refusal",
    );
  });

  it("asks for the whole answer again, as one bare JSON object and the only retry", () => {
    const prompt = complianceRetryPrompt('perPhase: phase "phase-03" is missing');
    expect(prompt).toContain('perPhase: phase "phase-03" is missing');
    expect(prompt).toContain("whole review");
    expect(prompt).toContain("one JSON object");
    expect(prompt).toContain("answer schema you were already given");
    expect(prompt).toContain("no code fence and no commentary");
    expect(prompt).toContain("only retry");
  });
});
