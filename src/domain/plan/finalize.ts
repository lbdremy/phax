import { Array as Arr, Either } from "effect";
import { slugifyShortName } from "../branded.js";
import { PlanValidationError } from "../errors.js";
import type { ExtractedPhaxPlan, PhaxPlan } from "../../schemas/phaxPlan.js";

export interface FinalizeResult {
  readonly plan: PhaxPlan;
  readonly warnings: string[];
  readonly detectedAnchors: string[];
}

// Derive each phase title from its plan.md heading rather than asking the model
// to round-trip it through JSON. A `"` in a title would otherwise derail the
// extraction model into malformed output.
function parsePhaseTitles(planMd: string): Map<string, string> {
  const titles = new Map<string, string>();
  const re = /^##\s+(phase-\d{2})\s*[—–-]\s*(.+?)\s*\{#[^}]*\}\s*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(planMd)) !== null) {
    const id = m[1]!.toLowerCase();
    const title = m[2]!.trim();
    if (title.length > 0) titles.set(id, title);
  }
  return titles;
}

function detectPhaseAnchors(planMd: string): string[] {
  const matches = planMd.match(/##\s+phase-\d{2}/gi) ?? [];
  return matches
    .map((m) => {
      const id = m.match(/phase-\d{2}/i);
      return id ? id[0].toLowerCase() : "";
    })
    .filter(Boolean);
}

/**
 * Pure post-processing of a validated LLM extraction. Derives titles from
 * headings, slugifies shortName, sets branch, detects anchors, and collects
 * warnings. Returns Left<PlanValidationError> if any phase lacks a title
 * heading; the caller is responsible for raising Left to an Effect failure.
 */
export function finalizeExtractedPlan(
  extracted: ExtractedPhaxPlan,
  planMd: string,
): Either.Either<FinalizeResult, PlanValidationError> {
  const phaseTitles = parsePhaseTitles(planMd);
  const missingTitle = extracted.phases.filter((p) => {
    const t = phaseTitles.get(p.id);
    return t === undefined || t.length === 0;
  });
  if (missingTitle.length > 0) {
    return Either.left(
      new PlanValidationError({
        message: `Could not derive a title from plan.md for: ${missingTitle.map((p) => p.id).join(", ")}. Each phase needs a "## <phase-id> — <title> {#anchor}" heading.`,
      }),
    );
  }

  const phasesWithTitles = Arr.map(extracted.phases, (p) => ({
    ...p,
    title: phaseTitles.get(p.id) as string,
  }));

  const shortName =
    slugifyShortName(extracted.run.shortName) || slugifyShortName(extracted.run.title) || "run";

  const plan: PhaxPlan = {
    version: extracted.version,
    run: {
      ...extracted.run,
      shortName,
      branch: `phax/${shortName}`,
      requiredCommands: extracted.run.requiredCommands,
    },
    phases: phasesWithTitles,
  };

  const detectedAnchors = detectPhaseAnchors(planMd);
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

  return Either.right({ plan, warnings, detectedAnchors });
}
