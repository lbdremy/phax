import type { GateRequest } from "../../schemas/gateRequest.js";
import type { OutsideBriefRequest, PhaseBriefRequest } from "../../schemas/brief.js";

/**
 * The brief request inside a phase: the phase facts of the phase's gate
 * request, copied unchanged and never recomputed, then `files`. `null` asks
 * for the phase's brief (its planned files). Keys come in the format's order.
 */
export function phaseBriefRequest(
  facts: GateRequest,
  files: readonly [string, ...string[]] | null,
): PhaseBriefRequest {
  return {
    phase: facts.phase,
    base: facts.base,
    terminal: facts.terminal,
    phases: facts.phases,
    files,
  };
}

/** The brief request outside a phase: the paths alone. */
export function outsideBriefRequest(files: readonly [string, ...string[]]): OutsideBriefRequest {
  return { files };
}
