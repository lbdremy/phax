// The `agent` group answers through the command runner (src/cli/definitions/agent.ts). These
// run functions are kept, until the last plan of command-contracts, as the definitions' run and
// render over the OutputPort, for the tests that call them.
import type { OutputPort } from "../../ports/output.js";
import { runThroughOutput } from "../bridge.js";
import {
  makeAgentModelsCommand,
  makeAgentProbeCommand,
  makeAgentResolveCommand,
  makeAgentSetupMistralVibeCommand,
  makeAgentSetupProvidersCommand,
  REAL_AGENT_LAYERS,
} from "../definitions/agent.js";

export function runAgentModels(out: OutputPort): Promise<number> {
  return runThroughOutput(makeAgentModelsCommand(REAL_AGENT_LAYERS), {}, out, {
    lineByLine: true,
  });
}

export interface AgentResolveOptions {
  readonly model: string;
  readonly effort: string;
  readonly json?: boolean;
}

export function runAgentResolve(opts: AgentResolveOptions, out: OutputPort): Promise<number> {
  return runThroughOutput(
    makeAgentResolveCommand(REAL_AGENT_LAYERS),
    { flags: { model: opts.model, effort: opts.effort } },
    out,
    { json: opts.json === true, lineByLine: true, wholeDocument: true },
  );
}

export function runAgentProbe(out: OutputPort): Promise<number> {
  return runThroughOutput(makeAgentProbeCommand(REAL_AGENT_LAYERS), {}, out, {
    lineByLine: true,
  });
}

export interface AgentSetupMistralVibeOptions {
  readonly dryRun?: boolean;
  readonly installModelAliases?: boolean;
}

export function runAgentSetupMistralVibe(
  opts: AgentSetupMistralVibeOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(
    makeAgentSetupMistralVibeCommand(REAL_AGENT_LAYERS),
    {
      flags: {
        ...(opts.dryRun !== undefined ? { dryRun: opts.dryRun } : {}),
        ...(opts.installModelAliases !== undefined
          ? { installModelAliases: opts.installModelAliases }
          : {}),
      },
    },
    out,
    { lineByLine: true },
  );
}

export interface AgentSetupProvidersOptions {
  readonly write?: boolean;
  readonly prune?: boolean;
  readonly withRouting?: boolean;
}

export function runAgentSetupProviders(
  opts: AgentSetupProvidersOptions,
  out: OutputPort,
): Promise<number> {
  return runThroughOutput(
    makeAgentSetupProvidersCommand(REAL_AGENT_LAYERS),
    {
      flags: {
        ...(opts.write !== undefined ? { write: opts.write } : {}),
        ...(opts.prune !== undefined ? { prune: opts.prune } : {}),
        ...(opts.withRouting !== undefined ? { withRouting: opts.withRouting } : {}),
      },
    },
    out,
    { lineByLine: true },
  );
}
