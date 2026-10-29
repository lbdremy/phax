import { SkillEditConsentError, SkillEditProtectedError } from "../domain/errors.js";
import type { ProtectedList } from "../domain/security/protectedPaths.js";
import {
  checkSkillEditConsent,
  formatSkillEditConsentRefusal,
  formatSkillEditProtectedRefusal,
  type SkillEditConsentPhase,
  skillEditProtectedConflicts,
} from "../domain/security/skillEditGrants.js";

/**
 * The refusal for phases that declare `.claude/skills/**` files without skill
 * edit consent, or `undefined` when the run may proceed. `phax run` checks this
 * before it names the run or writes any state, so a missing flag never leaves a
 * failed run behind; `executePlan` checks it again to guard resume.
 */
export function skillEditConsentRefusal(
  phases: readonly SkillEditConsentPhase[],
  allowSkillEdits: boolean,
): SkillEditConsentError | undefined {
  const gaps = checkSkillEditConsent({ phases, allowSkillEdits });
  if (gaps.length === 0) return undefined;
  return new SkillEditConsentError({
    message: formatSkillEditConsentRefusal(gaps),
    phases: gaps,
  });
}

/**
 * The refusal for a skill edit grant on a protected path, or `undefined`. Only
 * a run that consented to skill edits and declares a list can have one: without
 * consent the consent refusal comes first.
 */
export function skillEditProtectedRefusal(
  phases: readonly SkillEditConsentPhase[],
  allowSkillEdits: boolean,
  list: ProtectedList | undefined,
): SkillEditProtectedError | undefined {
  if (!allowSkillEdits || list === undefined) return undefined;
  const conflicts = skillEditProtectedConflicts(phases, list);
  if (conflicts.length === 0) return undefined;
  return new SkillEditProtectedError({
    message: formatSkillEditProtectedRefusal(conflicts),
    conflicts,
  });
}
