/**
 * The one rule for which gate profiles phax.json defines, and for resolving a
 * profile by its id. Pure: it reads the decoded config's `gateProfiles` and
 * `workspaces` and nothing else.
 *
 * A profile is defined when phax.json's resolution turns it into at least one
 * step: a non-empty workspace entry under the id (for the run's workspace)
 * replaces the top-level one, and an empty entry is not defined.
 */
import { Result } from "effect";
import type { GateStep } from "../../schemas/phaxConfig.js";

type GateProfileEntries = Readonly<Record<string, readonly GateStep[]>>;

/** The parts of the decoded phax.json the rule reads; any entry may be empty. */
interface GateProfileConfig {
  readonly gateProfiles: GateProfileEntries;
  readonly workspaces?:
    | readonly { readonly id: string; readonly gateProfiles?: GateProfileEntries | undefined }[]
    | undefined;
}

const nonEmpty = (steps: readonly GateStep[] | undefined): steps is readonly GateStep[] =>
  steps !== undefined && steps.length > 0;

interface DefinedGateProfile {
  readonly id: string;
  readonly steps: readonly GateStep[];
}

/** A profile id phax.json does not define, with every id it does define. */
export interface UndefinedGateProfile {
  readonly id: string;
  readonly defined: readonly string[];
}

/**
 * The profiles phax.json defines, with the steps a run would use: top-level
 * entries first in phax.json order, then ids only the workspace layer defines.
 */
function definedGateProfiles(
  config: GateProfileConfig,
  workspaceId: string | undefined,
): readonly DefinedGateProfile[] {
  const workspaceProfiles =
    workspaceId === undefined
      ? undefined
      : config.workspaces?.find((w) => w.id === workspaceId)?.gateProfiles;
  const defined: DefinedGateProfile[] = [];
  for (const [id, topLevel] of Object.entries(config.gateProfiles)) {
    const own = workspaceProfiles?.[id];
    if (nonEmpty(own)) defined.push({ id, steps: own });
    else if (nonEmpty(topLevel)) defined.push({ id, steps: topLevel });
  }
  for (const [id, own] of Object.entries(workspaceProfiles ?? {})) {
    if (Object.hasOwn(config.gateProfiles, id)) continue;
    if (nonEmpty(own)) defined.push({ id, steps: own });
  }
  return defined;
}

/** A profile's steps, or a refusal naming the id and every defined id. */
export function resolveGateProfileById(
  config: GateProfileConfig,
  id: string,
  workspaceId: string | undefined,
): Result.Result<readonly GateStep[], UndefinedGateProfile> {
  const defined = definedGateProfiles(config, workspaceId);
  const profile = defined.find((p) => p.id === id);
  return profile === undefined
    ? Result.fail({ id, defined: defined.map((p) => p.id) })
    : Result.succeed(profile.steps);
}

/** The refusal's text, printed as is by every command that refuses an undefined profile. */
export function undefinedGateProfileMessage(u: UndefinedGateProfile): string {
  const defined = u.defined.length === 0 ? "none" : u.defined.join(", ");
  return `gate profile "${u.id}" is not defined in phax.json (defined: ${defined})`;
}
