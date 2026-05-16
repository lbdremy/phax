import {
  archiveRun,
  pendingToSettingUp,
  rateLimitPhase,
  rateLimitRun,
  rateLimitedToRunning,
  resumeRateLimitedRun,
  skipPhase,
  startRun,
} from "../../src/domain/state.js";

// Legal: valid RunState values are accepted by the transition functions
const r1 = startRun("created");
const r2 = archiveRun("review_open");
const r3 = archiveRun("completed");
const r4 = rateLimitRun("running");
const r5 = resumeRateLimitedRun("rate_limited");

// Legal: valid PhaseState values are accepted
const p1 = pendingToSettingUp("pending");
const p2 = skipPhase("pending");
const p3 = rateLimitPhase("running");
const p4 = rateLimitedToRunning("rate_limited");

// Suppress unused-variable lint
void r1;
void r2;
void r3;
void r4;
void r5;
void p1;
void p2;
void p3;
void p4;

// Illegal: non-RunState string literals are rejected
// @ts-expect-error: "invalid-state" is not a valid RunState
startRun("invalid-state");

// @ts-expect-error: "review-open" (wrong casing) is not a valid RunState
archiveRun("review-open");

// @ts-expect-error: "CREATED" is not a valid RunState
startRun("CREATED");

// Illegal: non-PhaseState string literals are rejected
// @ts-expect-error: "active" is not a valid PhaseState
pendingToSettingUp("active");

// @ts-expect-error: "in_progress" is not a valid PhaseState
skipPhase("in_progress");

// Illegal: non-string types are rejected entirely
// @ts-expect-error: number is not assignable to RunState
startRun(1);

// @ts-expect-error: null is not assignable to PhaseState
pendingToSettingUp(null);
