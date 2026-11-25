import { Array as Arr, Result } from "effect";
import { slugifyShortName } from "../branded.js";
import { PlanValidationError } from "../errors.js";
import type { ExtractedPhaxPlan, PhaxPlan } from "../../schemas/phaxPlan.js";
import { readPlanGateProfile } from "./parsePlanMarkdown.js";
import { phaseHeadingSources } from "./sections.js";

export interface FinalizeResult {
  readonly plan: PhaxPlan;
  readonly warnings: string[];
  readonly detectedAnchors: string[];
}

const PHASE_TITLE_RE = /^##\s+(phase-\d{2})\s*[—–-]\s*(.+?)\s*\{#[^}]*\}\s*$/i;

type PhaseHeadings = ReturnType<typeof phaseHeadingSources>;

// Derive each phase title from its plan.md heading rather than asking the model
// to round-trip it through JSON. A `"` in a title would otherwise derail the
// extraction model into malformed output. Only the root-level phase headings
// count, read as written: a heading-shaped line inside a fenced code block or an
// HTML block is not a phase heading and never renames a phase.
function parsePhaseTitles(headings: PhaseHeadings): Map<string, string> {
  const titles = new Map<string, string>();
  for (const { source } of headings) {
    const m = PHASE_TITLE_RE.exec(source);
    if (m === null) continue;
    const id = m[1]!.toLowerCase();
    const title = m[2]!.trim();
    if (title.length > 0) titles.set(id, title);
  }
  return titles;
}

/**
 * Pure post-processing of a validated LLM extraction. Derives titles from
 * headings, slugifies shortName, sets branch, sets the run's gate profile to
 * the one plan.md declares, detects anchors, and collects warnings. Returns
 * Left<PlanValidationError> if any phase lacks a title heading, or if plan.md
 * declares no gate profile or more than one; the caller is responsible for
 * raising Left to an Effect failure.
 */
export function finalizeExtractedPlan(
  extracted: ExtractedPhaxPlan,
  planMd: string,
): Result.Result<FinalizeResult, PlanValidationError> {
  // The ids of the root-level `## phase-NN` headings, as the parser recognises them: a
  // `## phase-NN` written mid-line, inside a list or in a code block is not a phase heading.
  const headings = phaseHeadingSources(planMd);
  const phaseTitles = parsePhaseTitles(headings);
  const missingTitle = extracted.phases.filter((p) => {
    const t = phaseTitles.get(p.id);
    return t === undefined || t.length === 0;
  });
  if (missingTitle.length > 0) {
    return Result.fail(
      new PlanValidationError({
        message: `Could not derive a title from plan.md for: ${missingTitle.map((p) => p.id).join(", ")}. Each phase needs a "## <phase-id> — <title> {#anchor}" heading.`,
      }),
    );
  }

  const phasesWithTitles = Arr.map(extracted.phases, (p) => ({
    ...p,
    // Every phase has a title here: one missing is refused above.
    title: phaseTitles.get(p.id) ?? "",
  }));

  // The run's gate profile is phax's own reading of the plan's `## Gate
  // profile` section, whatever the extracted value says: on the fallback path
  // the model is never asked for it.
  const gateProfile = readPlanGateProfile(planMd);
  if (Result.isFailure(gateProfile)) return Result.fail(gateProfile.failure);

  const shortName =
    slugifyShortName(extracted.run.shortName) || slugifyShortName(extracted.run.title) || "run";

  const plan: PhaxPlan = {
    run: {
      ...extracted.run,
      shortName,
      branch: `phax/${shortName}`,
      requiredCommands: extracted.run.requiredCommands,
      gateProfile: gateProfile.success,
    },
    phases: phasesWithTitles,
  };

  const detectedAnchors = headings.map((h) => h.phaseId);
  const warnings: string[] = [];

  if (detectedAnchors.length > 0 && plan.phases.length !== detectedAnchors.length) {
    warnings.push(
      `plan.md has ${detectedAnchors.length} detected phase anchor(s) but ${plan.phases.length} phase(s) were extracted.`,
    );
  }

  for (const phase of plan.phases) {
    const anchorPhaseId = phase.planMarkdownAnchor.match(/phase-\d{2}/i)?.[0]?.toLowerCase();
    if (anchorPhaseId && !detectedAnchors.includes(anchorPhaseId)) {
      warnings.push(
        `Phase "${phase.id}" references anchor "${phase.planMarkdownAnchor}" not found in plan.md.`,
      );
    }
  }

  return Result.succeed({ plan, warnings, detectedAnchors });
}
