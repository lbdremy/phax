import { describe, expect, it } from "vitest";
import {
  CODE_REVIEW_RETRY_STREAM_FILENAME,
  codeReviewRefusedTwiceMessage,
  codeReviewRetryPrompt,
  codeReviewRetryWarning,
} from "../../../src/domain/review/codeReviewRetry.js";

describe("the code review's corrective resume texts", () => {
  it("keeps its transcript beside the first session's", () => {
    expect(CODE_REVIEW_RETRY_STREAM_FILENAME).toBe("code-review-retry.session.jsonl");
  });

  it("warns with the refusal and the single resume", () => {
    expect(codeReviewRetryWarning("findings[0].lens: not a lens")).toBe(
      "code-review answer refused — findings[0].lens: not a lens\n  resuming the session once to ask for the whole answer again",
    );
  });

  it("names both refusals when the retry is refused too", () => {
    expect(codeReviewRefusedTwiceMessage("first refusal", "second refusal")).toBe(
      "code-review answer rejected twice — first answer: first refusal; retry: second refusal",
    );
  });

  it("asks for the whole answer again, as one bare JSON object and the only retry", () => {
    const prompt = codeReviewRetryPrompt("missing $schema");
    expect(prompt).toContain("missing $schema");
    expect(prompt).toContain("whole review");
    expect(prompt).toContain("one JSON object");
    expect(prompt).toContain("answer schema you were already given");
    expect(prompt).toContain("no code fence and no commentary");
    expect(prompt).toContain("only retry");
  });
});
