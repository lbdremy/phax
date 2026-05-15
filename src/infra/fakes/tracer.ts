import { Effect, Layer } from "effect";
import { Tracer, type TracerOps, type TraceEvent } from "../../ports/tracer.js";

export class FakeTracerImpl implements TracerOps {
  readonly events: TraceEvent[] = [];

  event(e: TraceEvent): Effect.Effect<void, never, never> {
    return Effect.sync(() => {
      this.events.push(e);
    });
  }

  /** Names of every emitted event, in order. */
  eventNames(): string[] {
    return this.events.map((e) => e.event);
  }
}

export const makeFakeTracer = () => {
  const impl = new FakeTracerImpl();
  const layer = Layer.succeed(Tracer, impl);
  return { impl, layer } as const;
};
