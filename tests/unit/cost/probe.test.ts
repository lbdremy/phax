// The probe's windows from made-up stream facts: both windows, no
// subscription, and every unusable probe as unavailable with its reason.
import { describe, expect, it } from "vitest";
import {
  PROBE_EFFORT,
  PROBE_MODEL,
  PROBE_PROMPT,
  windowsFromProbe,
} from "../../../src/domain/cost/probe.js";
import { HOUR_MS, iso, NOW_MS, streamFacts } from "../../helpers/costHistory.js";

const fiveHourReset = Math.floor((NOW_MS + 2 * HOUR_MS) / 1000);
const sevenDayReset = Math.floor((NOW_MS + 80 * HOUR_MS) / 1000);

const fiveHour = (fraction: number, resetsAtEpochSeconds = fiveHourReset) =>
  ({ window: "five-hour", fraction, resetsAtEpochSeconds }) as const;
const sevenDay = (fraction: number, resetsAtEpochSeconds = sevenDayReset) =>
  ({ window: "seven-day", fraction, resetsAtEpochSeconds }) as const;

/** The reading's reason when unavailable, else its kind. */
function reason(outcome: Parameters<typeof windowsFromProbe>[0]): string {
  const reading = windowsFromProbe(outcome, NOW_MS);
  return reading.kind === "unavailable" ? reading.reason : reading.kind;
}

describe("probe constants", () => {
  it("probes the cheapest model at low effort with a fixed prompt", () => {
    expect([PROBE_MODEL, PROBE_EFFORT, PROBE_PROMPT]).toEqual([
      "claude-haiku-5-5",
      "low",
      "Reply with: ok",
    ]);
  });
});

describe("windowsFromProbe", () => {
  it("reads 15 % and 29 % with both reset instants", () => {
    const facts = streamFacts({ rateLimits: [[fiveHour(0.15), sevenDay(0.29)]] });
    expect(windowsFromProbe({ kind: "ended", facts, exitCode: 0 }, NOW_MS)).toEqual({
      kind: "windows",
      source: "probe",
      observedAt: iso(NOW_MS),
      fiveHour: { utilization: 15, resetsAt: iso(fiveHourReset * 1000) },
      sevenDay: { utilization: 29, resetsAt: iso(sevenDayReset * 1000) },
    });
  });

  it("takes each window's last reading across events, clamps and rounds, and empties a passed reset", () => {
    const passed = Math.floor((NOW_MS - HOUR_MS) / 1000);
    const facts = streamFacts({
      rateLimits: [[fiveHour(0.1), sevenDay(0.2)], [sevenDay(1.234567)], [fiveHour(0.5, passed)]],
    });
    const reading = windowsFromProbe({ kind: "ended", facts, exitCode: 0 }, NOW_MS);
    expect(reading).toMatchObject({
      kind: "windows",
      fiveHour: { utilization: 0, resetsAt: iso(NOW_MS + 5 * HOUR_MS) },
      sevenDay: { utilization: 100 },
    });
    const rounded = windowsFromProbe(
      {
        kind: "ended",
        facts: streamFacts({ rateLimits: [[fiveHour(0.123456), sevenDay(0.5)]] }),
        exitCode: 0,
      },
      NOW_MS,
    );
    expect(rounded).toMatchObject({ fiveHour: { utilization: 12.35 } });
  });

  it("gives no-subscription for an API key source other than none and no event", () => {
    const facts = streamFacts({ apiKeySource: "ANTHROPIC_API_KEY" });
    expect(windowsFromProbe({ kind: "ended", facts, exitCode: 0 }, NOW_MS)).toEqual({
      kind: "no-subscription",
    });
  });

  it("never guesses: each unusable probe is unavailable with a reason naming the case", () => {
    expect(reason({ kind: "failed-to-start", reason: "claude: command not found" })).toBe(
      "the probe failed to start: claude: command not found",
    );
    expect(reason({ kind: "ended", facts: streamFacts(), exitCode: 0 })).toBe(
      "the probe ended without a rate-limit event",
    );
    expect(
      reason({
        kind: "ended",
        facts: streamFacts({
          rateLimits: [[fiveHour(0.15), sevenDay(0.29)]],
          undecodedRateLimitEvents: 1,
        }),
        exitCode: 0,
      }),
    ).toBe("the probe's rate-limit event has a shape phax does not decode");
    expect(
      reason({
        kind: "ended",
        facts: streamFacts({ rateLimits: [[fiveHour(0.15)]] }),
        exitCode: 0,
      }),
    ).toBe("the probe reported the five-hour window only");
    expect(
      reason({
        kind: "ended",
        facts: streamFacts({ rateLimits: [[sevenDay(0.15)]] }),
        exitCode: 0,
      }),
    ).toBe("the probe reported the seven-day window only");
    expect(reason({ kind: "ended", facts: streamFacts(), exitCode: 1 })).toBe(
      "the probe exited with code 1 without a rate-limit event",
    );
  });

  it("reads an undecodable event as unavailable even with an API key source", () => {
    const facts = streamFacts({ apiKeySource: "ANTHROPIC_API_KEY", undecodedRateLimitEvents: 2 });
    expect(windowsFromProbe({ kind: "ended", facts, exitCode: 0 }, NOW_MS)).toEqual({
      kind: "unavailable",
      reason: "the probe's rate-limit event has a shape phax does not decode",
    });
  });
});
