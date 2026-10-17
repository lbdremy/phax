// probeWindows on the fake Backend with made-up stream lines: both windows
// read, an API-key login, and the probes that cannot be read. No test spawns
// a provider.
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { probeWindows } from "../../src/app/probeWindows.js";
import { PROBE_EFFORT, PROBE_MODEL, PROBE_PROMPT } from "../../src/domain/cost/probe.js";
import { makeFakeBackend } from "../../src/infra/fakes/backend.js";
import { HOUR_MS, NOW_MS, iso } from "../helpers/costHistory.js";

const NOW = iso(NOW_MS);
const FIVE_HOUR_RESET_S = (NOW_MS + 2 * HOUR_MS) / 1000;
const SEVEN_DAY_RESET_S = (NOW_MS + 50 * HOUR_MS) / 1000;

const line = (event: object): string => JSON.stringify(event);

const init = (apiKeySource: string) =>
  line({
    type: "system",
    subtype: "init",
    session_id: "aaaaaaaa-0000-4000-8000-000000000001",
    claude_code_version: "2.1.302",
    apiKeySource,
  });

const rateLimit = (windows: object) =>
  line({
    type: "rate_limit_event",
    rate_limit_info: { status: "allowed", unifiedWindows: windows },
  });

const result = line({
  type: "result",
  session_id: "aaaaaaaa-0000-4000-8000-000000000001",
  duration_ms: 900,
  modelUsage: { "claude-haiku-5-5": { inputTokens: 12, outputTokens: 2, costUSD: 0.00002 } },
});

function run(fake: ReturnType<typeof makeFakeBackend>) {
  return Effect.runPromise(probeWindows(NOW).pipe(Effect.provide(fake.layer)));
}

describe("probeWindows", () => {
  it("reads both windows after exactly one probe with the fixed prompt (§8 the probe reads both windows)", async () => {
    const fake = makeFakeBackend();
    fake.impl.addProbeResponse({
      lines: [
        init("none"),
        rateLimit({
          five_hour: { utilization: 0.15, resetsAt: FIVE_HOUR_RESET_S },
          seven_day: { utilization: 0.29, resetsAt: SEVEN_DAY_RESET_S },
        }),
        result,
      ],
      exitCode: 0,
    });

    const reading = await run(fake);

    expect(reading).toEqual({
      kind: "windows",
      source: "probe",
      observedAt: NOW,
      fiveHour: { utilization: 15, resetsAt: iso(FIVE_HOUR_RESET_S * 1000) },
      sevenDay: { utilization: 29, resetsAt: iso(SEVEN_DAY_RESET_S * 1000) },
    });
    expect(fake.impl.probeCalls).toEqual([
      { prompt: PROBE_PROMPT, options: { model: PROBE_MODEL, effort: PROBE_EFFORT } },
    ]);
    expect(fake.impl.runCalls).toHaveLength(0);
    expect(fake.impl.resumeCalls).toHaveLength(0);
    expect(fake.impl.completeCalls).toHaveLength(0);
  });

  it("gives no-subscription when an API key signed the probe in (§8 no subscription)", async () => {
    const fake = makeFakeBackend();
    fake.impl.addProbeResponse({ lines: [init("ANTHROPIC_API_KEY"), result], exitCode: 0 });

    expect(await run(fake)).toEqual({ kind: "no-subscription" });
  });

  describe("an unusable probe never guesses (§8)", () => {
    it("a failed start is unavailable with the spawn error", async () => {
      const fake = makeFakeBackend();
      fake.impl.failNextProbe("spawn claude ENOENT");

      expect(await run(fake)).toEqual({
        kind: "unavailable",
        reason: "the probe failed to start: spawn claude ENOENT",
      });
    });

    it("no rate-limit event is unavailable", async () => {
      const fake = makeFakeBackend();
      fake.impl.addProbeResponse({ lines: [init("none"), result], exitCode: 0 });

      expect(await run(fake)).toEqual({
        kind: "unavailable",
        reason: "the probe ended without a rate-limit event",
      });
    });

    it("a rate-limit event of an unknown shape is unavailable, never a partial read", async () => {
      const fake = makeFakeBackend();
      fake.impl.addProbeResponse({
        lines: [
          init("none"),
          rateLimit({
            five_hour: { utilization: 0.15, resetsAt: FIVE_HOUR_RESET_S },
            seven_day: { utilization: 0.29, resetsAt: SEVEN_DAY_RESET_S },
          }),
          rateLimit({ five_hour: { utilization: "fifteen", resetsAt: FIVE_HOUR_RESET_S } }),
          result,
        ],
        exitCode: 0,
      });

      expect(await run(fake)).toEqual({
        kind: "unavailable",
        reason: "the probe's rate-limit event has a shape phax does not decode",
      });
    });

    it("a non-zero exit without an event is unavailable with the code", async () => {
      const fake = makeFakeBackend();
      fake.impl.addProbeResponse({ lines: [init("none")], exitCode: 1 });

      expect(await run(fake)).toEqual({
        kind: "unavailable",
        reason: "the probe exited with code 1 without a rate-limit event",
      });
    });
  });
});
