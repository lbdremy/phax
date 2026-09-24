import { SkillEditConsentError } from "../domain/errors.js";
import {
  checkSkillEditConsent,
  formatSkillEditConsentRefusal,
  type SkillEditConsentPhase,
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
