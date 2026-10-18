// The subscription windows a minimal Claude Code probe reports. Pure. The
// probe sends a fixed prompt, never a plan; its stream's rate-limit events
// give both windows, its init event's API key source tells an API key from a
// subscription login, and anything else is unavailable with its reason —
// never a partial read.
import type { ClaudeStreamFacts } from "../../schemas/claudeStream.js";
import type { WindowsReading } from "./estimate.js";
import type { SubscriptionWindow } from "./forecast.js";
import { currentWindow } from "./history.js";

/** The cheapest Claude list price. */
export const PROBE_MODEL = "claude-haiku-5-5";
export const PROBE_EFFORT = "low";
export const PROBE_PROMPT = "Reply with: ok";
/** A one-message reply takes seconds; past this the probe is stopped, never waited on. */
export const PROBE_TIMEOUT_MS = 60_000;
/** The most of Claude Code's stderr a reason quotes. */
const STDERR_EXCERPT_CHARS = 200;

/** How the probe went: it never started, was stopped at its timeout, or ended with an exit code. */
export type ProbeOutcome =
  | { readonly kind: "failed-to-start"; readonly reason: string }
  | { readonly kind: "timed-out" }
  | {
      readonly kind: "ended";
      readonly facts: ClaudeStreamFacts;
      readonly exitCode: number;
      readonly stderr: string;
    };

function lastReading(facts: ClaudeStreamFacts, window: SubscriptionWindow) {
  let found: { readonly fraction: number; readonly resetsAtEpochSeconds: number } | null = null;
  for (const event of facts.events) {
    if (event.kind !== "rate-limit") continue;
    for (const reading of event.readings) {
      if (reading.window === window) found = reading;
    }
  }
  return found;
}

/** The first non-blank line of stderr, cut to STDERR_EXCERPT_CHARS; empty when there is none. */
function stderrExcerpt(stderr: string): string {
  const first = stderr
    .split("\n")
    .map((text) => text.trim())
    .find((text) => text !== "");
  if (first === undefined) return "";
  return first.length > STDERR_EXCERPT_CHARS ? `${first.slice(0, STDERR_EXCERPT_CHARS)}…` : first;
}

function utilizationOf(fraction: number): number {
  return Math.min(100, Math.max(0, Math.round(fraction * 100 * 100) / 100));
}

/** The probe's windows, in the order: start, timeout, undecodable event, both windows, API key, exit, one window. */
export function windowsFromProbe(outcome: ProbeOutcome, nowMs: number): WindowsReading {
  if (outcome.kind === "failed-to-start") {
    return { kind: "unavailable", reason: `the probe failed to start: ${outcome.reason}` };
  }
  if (outcome.kind === "timed-out") {
    return {
      kind: "unavailable",
      reason: `the probe timed out after ${PROBE_TIMEOUT_MS / 1000} s and was stopped`,
    };
  }
  const { facts, exitCode } = outcome;
  if (facts.undecodedRateLimitEvents > 0) {
    return {
      kind: "unavailable",
      reason: "the probe's rate-limit event has a shape phax does not decode",
    };
  }
  const fiveHour = lastReading(facts, "five-hour");
  const sevenDay = lastReading(facts, "seven-day");
  if (fiveHour !== null && sevenDay !== null) {
    return {
      kind: "windows",
      source: "probe",
      observedAt: new Date(nowMs).toISOString(),
      fiveHour: currentWindow(
        utilizationOf(fiveHour.fraction),
        fiveHour.resetsAtEpochSeconds * 1000,
        "five-hour",
        nowMs,
      ),
      sevenDay: currentWindow(
        utilizationOf(sevenDay.fraction),
        sevenDay.resetsAtEpochSeconds * 1000,
        "seven-day",
        nowMs,
      ),
    };
  }
  if (facts.apiKeySource !== null && facts.apiKeySource !== "none") {
    return { kind: "no-subscription" };
  }
  if (exitCode !== 0) {
    const excerpt = stderrExcerpt(outcome.stderr);
    return {
      kind: "unavailable",
      reason: `the probe exited with code ${exitCode} without a rate-limit event${excerpt === "" ? "" : `: ${excerpt}`}`,
    };
  }
  if (fiveHour !== null || sevenDay !== null) {
    const window = fiveHour !== null ? "five-hour" : "seven-day";
    return { kind: "unavailable", reason: `the probe reported the ${window} window only` };
  }
  return { kind: "unavailable", reason: "the probe ended without a rate-limit event" };
}
