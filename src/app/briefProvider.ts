import { Effect, Either } from "effect";
import type { Shell } from "../ports/shell.js";
import {
  encodeBriefRecordFile,
  encodeBriefRequestFile,
  type BriefAnswer,
  type BriefRequest,
  type BriefRequestFile,
} from "../schemas/brief.js";
import { describeBriefAnswerError, readBriefAnswer, withSchemaUrl } from "../schemas/persisted.js";
import { runProviderQuery, type ProviderQueryFailure } from "./providerQuery.js";

/**
 * The brief provider's wall-clock limit, for pushes and pulls alike. Fixed,
 * not a config key (spec Q9): a brief informs, so it must never hold a phase
 * or a `phax brief` call for long.
 */
export const BRIEF_TIMEOUT_MS = 60_000;

/**
 * One brief call's outcome. `answer` is the provider's stdout parsed as JSON
 * and otherwise untouched, kept for the record; `decoded` is what phax reads.
 */
export type BriefOutcome =
  | { readonly kind: "answered"; readonly answer: unknown; readonly decoded: BriefAnswer }
  | { readonly kind: "failed"; readonly reason: string };

export function stampBriefRequest(request: BriefRequest): BriefRequestFile {
  return withSchemaUrl("brief-request", request);
}

function failureReason(failure: ProviderQueryFailure): string {
  const stderr = failure.stderrExcerpt?.trim();
  return stderr ? `${failure.message}: ${stderr}` : failure.message;
}

/**
 * Asks the brief provider once: no shell, run from `cwd`, the stamped request
 * on stdin. The answer is read by its own `$schema`. Every failure becomes a
 * `failed` outcome with a one-line reason; this never fails.
 */
export function queryBrief(input: {
  readonly command: string;
  readonly request: BriefRequestFile;
  readonly cwd: string;
  /** Tests only: no config key or flag reaches it. */
  readonly timeoutMs?: number;
}): Effect.Effect<BriefOutcome, never, Shell> {
  return Effect.gen(function* () {
    const ran = yield* runProviderQuery(
      "brief provider",
      input.command,
      input.cwd,
      input.request,
      (raw: unknown) => Either.right(raw),
      (failure) => failure,
      { timeoutMs: input.timeoutMs ?? BRIEF_TIMEOUT_MS },
    );
    if (Either.isLeft(ran)) {
      return { kind: "failed", reason: failureReason(ran.left) } as const;
    }
    const decoded = readBriefAnswer(ran.right);
    if (Either.isLeft(decoded)) {
      return { kind: "failed", reason: describeBriefAnswerError(decoded.left) } as const;
    }
    return { kind: "answered", answer: ran.right, decoded: decoded.right } as const;
  });
}

/** The bytes of `.phax-context/brief-request.json`. */
export function serializeBriefRequest(request: BriefRequestFile): string {
  return JSON.stringify(encodeBriefRequestFile(request), null, 2);
}

/**
 * The bytes of one `brief-NN.json`. The answer goes in as printed, never
 * re-stamped or re-shaped.
 */
export function serializeBriefRecord(
  moment: "pushed" | "pulled",
  request: BriefRequestFile,
  outcome: BriefOutcome,
): string {
  return JSON.stringify(
    encodeBriefRecordFile(
      withSchemaUrl("brief-record", {
        moment,
        request,
        outcome:
          outcome.kind === "answered"
            ? { kind: "answered" as const, answer: outcome.answer as Record<string, unknown> }
            : { kind: "failed" as const, reason: outcome.reason },
      }),
    ),
    null,
    2,
  );
}
