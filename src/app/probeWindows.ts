// Reads the subscription windows from one minimal Claude Code probe. The only
// input is the instant, so no plan can reach the probe: it sends the fixed
// PROBE_PROMPT. Its stream is decoded at the schema boundary and read by the
// domain. The probe belongs to no run, so it is not wrapped in
// `withInvocationCost` and writes no ledger entry.
import { Effect } from "effect";
import type { WindowsReading } from "../domain/cost/estimate.js";
import {
  PROBE_EFFORT,
  PROBE_MODEL,
  PROBE_PROMPT,
  windowsFromProbe,
  type ProbeOutcome,
} from "../domain/cost/probe.js";
import { Backend } from "../ports/backend.js";
import { parseClaudeStream } from "../schemas/claudeStream.js";

export function probeWindows(nowIso: string): Effect.Effect<WindowsReading, never, Backend> {
  return Effect.gen(function* () {
    const backend = yield* Backend;
    const outcome = yield* backend
      .probe(PROBE_PROMPT, { model: PROBE_MODEL, effort: PROBE_EFFORT })
      .pipe(
        Effect.map(
          (result): ProbeOutcome => ({
            kind: "ended",
            facts: parseClaudeStream(result.lines),
            exitCode: result.exitCode,
          }),
        ),
        Effect.catchAll((error) =>
          Effect.succeed<ProbeOutcome>({ kind: "failed-to-start", reason: error.message }),
        ),
      );
    return windowsFromProbe(outcome, Date.parse(nowIso));
  });
}
