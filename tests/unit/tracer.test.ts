import { Effect } from "effect";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatTraceEvent,
  makeTraceTracerLayer,
  makeVerboseTracerLayer,
  NoopTracerLayer,
} from "../../src/infra/tracer.js";
import type { OutputPort } from "../../src/ports/output.js";
import { Tracer, type TraceEvent } from "../../src/ports/tracer.js";

function makeFakeOutput() {
  const logs: string[] = [];
  const warns: string[] = [];
  const errors: string[] = [];
  const out: OutputPort = {
    log: (m) => logs.push(m),
    warn: (m) => warns.push(m),
    error: (m) => errors.push(m),
  };
  return { out, logs, warns, errors };
}

const sampleEvent: TraceEvent = {
  timestamp: "2026-05-15T00:00:00.000Z",
  run: "my-run",
  phase: "phase-01",
  event: "agent.invocation.started",
  boundary: "claude-code",
  status: "info",
  details: { model: "claude-sonnet-4-6" },
};

describe("formatTraceEvent", () => {
  it("renders the event name, phase, boundary, status and details", () => {
    const line = formatTraceEvent(sampleEvent);
    expect(line).toContain("agent.invocation.started");
    expect(line).toContain("phase-01");
    expect(line).toContain("[claude-code]");
    expect(line).toContain("info");
    expect(line).toContain("claude-sonnet-4-6");
  });

  it("omits phase, boundary and details when absent", () => {
    const line = formatTraceEvent({
      timestamp: "t",
      run: "r",
      event: "config.discovered",
      status: "ok",
    });
    expect(line).toBe("phax·config.discovered — ok");
  });
});

describe("NoopTracerLayer", () => {
  it("discards events without side effects", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* Tracer;
        yield* tracer.event(sampleEvent);
      }).pipe(Effect.provide(NoopTracerLayer)),
    );
  });
});

describe("makeVerboseTracerLayer", () => {
  it("renders ok events to log and failed events to error", async () => {
    const { out, logs, errors } = makeFakeOutput();
    await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* Tracer;
        yield* tracer.event(sampleEvent);
        yield* tracer.event({ ...sampleEvent, event: "gate.failed", status: "failed" });
      }).pipe(Effect.provide(makeVerboseTracerLayer(out))),
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("agent.invocation.started");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("gate.failed");
  });
});

describe("disposition trace event names", () => {
  it("accepts every event.<disposition> name through the verbose tracer", async () => {
    const { out, logs, errors } = makeFakeOutput();
    await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* Tracer;
        yield* tracer.event({ ...sampleEvent, event: "event.handled", status: "ok" });
        yield* tracer.event({ ...sampleEvent, event: "event.ignored", status: "info" });
        yield* tracer.event({ ...sampleEvent, event: "event.stale", status: "info" });
        yield* tracer.event({ ...sampleEvent, event: "event.rejected", status: "info" });
        yield* tracer.event({ ...sampleEvent, event: "event.unexpected", status: "failed" });
      }).pipe(Effect.provide(makeVerboseTracerLayer(out))),
    );
    expect(logs).toHaveLength(4);
    expect(logs.map((l) => l.includes("event.handled"))).toContain(true);
    expect(logs.map((l) => l.includes("event.ignored"))).toContain(true);
    expect(logs.map((l) => l.includes("event.stale"))).toContain(true);
    expect(logs.map((l) => l.includes("event.rejected"))).toContain(true);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("event.unexpected");
  });
});

describe("makeTraceTracerLayer", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "phax-tracer-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("appends one valid JSON line per event", async () => {
    const tracePath = join(dir, "nested", "trace.jsonl");
    const { out, logs } = makeFakeOutput();
    await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* Tracer;
        yield* tracer.event(sampleEvent);
        yield* tracer.event({ ...sampleEvent, event: "git.commit.created", status: "ok" });
      }).pipe(Effect.provide(makeTraceTracerLayer(tracePath, out, false))),
    );

    const raw = await readFile(tracePath, "utf8");
    const lines = raw.trim().split("\n");
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0]!) as TraceEvent;
    expect(first.event).toBe("agent.invocation.started");
    const second = JSON.parse(lines[1]!) as TraceEvent;
    expect(second.event).toBe("git.commit.created");
    // verbose forwarding disabled
    expect(logs).toHaveLength(0);
  });

  it("also renders verbosely when verbose forwarding is enabled", async () => {
    const tracePath = join(dir, "trace.jsonl");
    const { out, logs } = makeFakeOutput();
    await Effect.runPromise(
      Effect.gen(function* () {
        const tracer = yield* Tracer;
        yield* tracer.event(sampleEvent);
      }).pipe(Effect.provide(makeTraceTracerLayer(tracePath, out, true))),
    );
    expect(logs).toHaveLength(1);
    const raw = await readFile(tracePath, "utf8");
    expect(raw.trim().split("\n")).toHaveLength(1);
  });
});
