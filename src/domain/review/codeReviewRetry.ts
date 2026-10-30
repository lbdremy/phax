/** The corrective resume's transcript, beside the first session's `code-review.session.jsonl`. */
export const CODE_REVIEW_RETRY_STREAM_FILENAME = "code-review-retry.session.jsonl";

/** The prompt of the one corrective resume: it names the refusal and asks for the whole answer again. */
export function codeReviewRetryPrompt(refusal: string): string {
  return [
    `Your last answer was refused: ${refusal}`,
    "",
    "Answer again with the whole review, as one JSON object valid against the answer schema you were already given. Reply with that JSON object only: no code fence and no commentary. This is the only retry.",
  ].join("\n");
}

/** The line printed before the review's session is resumed. */
export function codeReviewRetryWarning(refusal: string): string {
  return `code-review answer refused — ${refusal}\n  resuming the session once to ask for the whole answer again`;
}

/** The failure reason of a review refused on its first answer and on its retry. */
export function codeReviewRefusedTwiceMessage(first: string, retry: string): string {
  return `code-review answer rejected twice — first answer: ${first}; retry: ${retry}`;
}
