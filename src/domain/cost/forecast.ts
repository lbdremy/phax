// The forward play behind `phax plans estimate`'s verdict. Pure. The phases'
// costs are spent in plan order at the agent burn rate through the five-hour
// and seven-day subscription windows; the run pauses when a window has no
// room left and resumes at its reset. The reference is the spike
// spikes/plan-estimate/phax_estimate.py (`play`).

export type SubscriptionWindow = "five-hour" | "seven-day";

/** Each window's length, ms: a window that has reset opens again for this long. */
export const WINDOW_MS: Readonly<Record<SubscriptionWindow, number>> = {
  "five-hour": 5 * 3_600_000,
  "seven-day": 7 * 86_400_000,
};

/** A window's state: utilization in percent, and when it resets. */
interface WindowState {
  readonly utilization: number;
  readonly resetsAtMs: number;
}

/** A pause: the phase it falls in, the exhausted window, when it starts and when the run resumes. */
interface Pause {
  readonly phase: string;
  readonly window: SubscriptionWindow;
  readonly atMs: number;
  readonly resumesAtMs: number;
}

export interface Playthrough {
  readonly pauses: readonly Pause[];
  readonly endsAtMs: number;
}

export interface PlayInput {
  readonly phaseCosts: ReadonlyArray<{ readonly phase: string; readonly usd: number }>;
  /** Positive. */
  readonly burnUsdPerHour: number;
  readonly fiveHour: WindowState;
  readonly sevenDay: WindowState;
  /** USD per 100 % of each window; both positive. */
  readonly capacity: { readonly fiveHourUsd: number; readonly sevenDayUsd: number };
  readonly nowMs: number;
}

const EPSILON = 1e-9;
const HOUR_MS = 3_600_000;

/**
 * Plays the phases forward from now. A window whose reset is reached opens
 * at utilization 0 for its length; each step spends the least of the phase's
 * cost left, both windows' room and the burn until the nearer reset; a
 * window with no room pauses the run until its reset.
 */
export function playForward(input: PlayInput): Playthrough {
  const { burnUsdPerHour: burn, capacity } = input;
  let t = input.nowMs;
  let u5 = input.fiveHour.utilization;
  let reset5 = input.fiveHour.resetsAtMs;
  let u7 = input.sevenDay.utilization;
  let reset7 = input.sevenDay.resetsAtMs;
  const pauses: Pause[] = [];

  for (const { phase, usd } of input.phaseCosts) {
    let left = usd;
    while (left > EPSILON) {
      if (t >= reset5) {
        u5 = 0;
        reset5 = t + WINDOW_MS["five-hour"];
      }
      if (t >= reset7) {
        u7 = 0;
        reset7 = t + WINDOW_MS["seven-day"];
      }
      const room5 = (Math.max(0, 100 - u5) * capacity.fiveHourUsd) / 100;
      const room7 = (Math.max(0, 100 - u7) * capacity.sevenDayUsd) / 100;
      if (room7 <= EPSILON) {
        pauses.push({ phase, window: "seven-day", atMs: t, resumesAtMs: reset7 });
        t = reset7;
        continue;
      }
      if (room5 <= EPSILON) {
        pauses.push({ phase, window: "five-hour", atMs: t, resumesAtMs: reset5 });
        t = reset5;
        continue;
      }
      const nextReset = Math.min(reset5, reset7);
      const untilReset = (burn * (nextReset - t)) / HOUR_MS;
      const step = Math.min(left, room5, room7, untilReset);
      left -= step;
      u5 += (step * 100) / capacity.fiveHourUsd;
      u7 += (step * 100) / capacity.sevenDayUsd;
      // Reaching a reset lands on it exactly, so rounding never leaves a sliver.
      t = step === untilReset ? nextReset : t + (step / burn) * HOUR_MS;
    }
  }
  return { pauses, endsAtMs: t };
}

/** `wait` when the P50 scenario pauses, `risky` when only P90 does, `fits` otherwise. */
export function verdictOf(p50: Playthrough, p90: Playthrough): "fits" | "risky" | "wait" {
  if (p50.pauses.length > 0) return "wait";
  if (p90.pauses.length > 0) return "risky";
  return "fits";
}
