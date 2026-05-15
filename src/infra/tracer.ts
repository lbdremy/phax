import { Effect, Layer } from "effect";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { OutputPort } from "../ports/output.js";
import { Tracer, type TraceEvent } from "../ports/tracer.js";

/** Render a trace event as a single human-readable verbose line. */
export function formatTraceEvent(e: TraceEvent): string {
  const phase = e.phase !== undefined ? ` ${e.phase}` : "";
  const boundary = e.boundary !== undefined ? ` [${e.boundary}]` : "";
  const detail =
    e.details !== undefined && Object.keys(e.details).length > 0
      ? ` ${JSON.stringify(e.details)}`
      : "";
  return `phax·${e.event}${phase}${boundary} — ${e.status}${detail}`;
}

function render(out: OutputPort, e: TraceEvent): void {
  const line = formatTraceEvent(e);
  if (e.status === "failed") {
    out.error(line);
  } else {
    out.log(line);
  }
}

/** Default tracer: discards every event. Used when neither --verbose nor --trace is set. */
export const NoopTracerLayer: Layer.Layer<Tracer> = Layer.succeed(Tracer, {
  event: () => Effect.void,
});

/** Verbose tracer: renders events to the OutputPort. No file IO. */
export function makeVerboseTracerLayer(out: OutputPort): Layer.Layer<Tracer> {
  return Layer.succeed(Tracer, {
    event: (e) => Effect.sync(() => render(out, e)),
  });
}

/**
 * Trace tracer: appends each event as one JSONL line to `traceJsonlPath`
 * (recommended `~/.phax/runs/<short>/trace.jsonl`). When `verbose` is true the
 * event is also rendered to the OutputPort. All IO errors are swallowed — a
 * failing tracer must never fail the run.
 */
export function makeTraceTracerLayer(
  traceJsonlPath: string,
  out: OutputPort,
  verbose: boolean,
): Layer.Layer<Tracer> {
  return Layer.succeed(Tracer, {
    event: (e) =>
      Effect.sync(() => {
        try {
          mkdirSync(dirname(traceJsonlPath), { recursive: true });
          appendFileSync(traceJsonlPath, `${JSON.stringify(e)}\n`, "utf8");
        } catch {
          // Tracing must never fail a run.
        }
        if (verbose) render(out, e);
      }),
  });
}
