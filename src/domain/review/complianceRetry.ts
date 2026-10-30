/** The first session's transcript, in the run folder. */
export const COMPLIANCE_REVIEW_STREAM_FILENAME = "compliance-review.session.jsonl";

/** The corrective resume's transcript, beside the first session's. */
export const COMPLIANCE_REVIEW_RETRY_STREAM_FILENAME = "compliance-review-retry.session.jsonl";

/** The prompt of the one corrective resume: it names the refusal and asks for the whole answer again. */
export function complianceRetryPrompt(refusal: string): string {
  return [
    `Your last answer was refused: ${refusal}`,
    "",
    "Answer again with the whole review, as one JSON object valid against the answer schema you were already given. Reply with that JSON object only: no code fence and no commentary. This is the only retry.",
  ].join("\n");
}

/** The line printed before the review's session is resumed. */
export function complianceRetryWarning(refusal: string): string {
  return `compliance-review answer refused — ${refusal}\n  resuming the session once to ask for the whole answer again`;
}

/** What a failed review adds when an earlier review's compliance-review.json is still in place. */
export const COMPLIANCE_EARLIER_REVIEW_KEPT =
  "the earlier review is kept (the run folder and the PR body still show it)";

/** A failed review's reason as printed: it says when an earlier review is kept. */
export function complianceFailureReason(reason: string, earlierReviewKept: boolean): string {
  return earlierReviewKept ? `${reason}; ${COMPLIANCE_EARLIER_REVIEW_KEPT}` : reason;
}

/** The failure reason of a review refused on its first answer and on its retry. */
export function complianceRefusedTwiceMessage(first: string, retry: string): string {
  return `compliance-review answer rejected twice — first answer: ${first}; retry: ${retry}`;
}
