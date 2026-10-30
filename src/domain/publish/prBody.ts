import type { CodeReview, CodeReviewFinding } from "../../schemas/codeReview.js";
import type { AnyShapeComplianceReview } from "../../schemas/complianceReview.js";
import type { RecordedSurface } from "../../schemas/surface.js";
import {
  findUnexplainedGlobalDeviations,
  type UnexplainedDeviation,
} from "../reconciliation/explained.js";
import type { GlobalFileReconciliation } from "../reconciliation/global.js";
import { prPhaseStopSuffix, type ReviewedPhase } from "../interactive/reviewedPhases.js";
import { onOneLine } from "../reportText.js";
import { renderPlanRef, renderPrFooter, type PrFooterInput } from "./prFooter.js";
import { renderReviewNotesSection, type ReviewNoteGroup } from "../review/reviewNotes.js";

// GitHub PR bodies cap at ~65536 bytes. We use a safe margin below that limit.
export const PR_BODY_MAX_BYTES = 60000;

const SHORTENED_NOTE =
  "\n\n---\n\n*This description was shortened to fit GitHub's limit. " +
  "The review handoff named under Full detail lists every entry.*";

/** How a phase ended, as the PR body counts it. */
type PrBodyPhaseStatus = "passed" | "skipped" | "unfinished";

/** The decoded run facts the short PR body is built from. */
export interface ShortPrBodyInput {
  // The run's qualified name (`<namespace>.<name>`) and its short name.
  readonly qualifiedName: string;
  readonly shortName: string;
  // The one-line fragment of source-spec-outcome.md, when the run states one.
  readonly sourceSpecOutcome: string | undefined;
  readonly gateProfileId: string | undefined;
  // In plan order.
  readonly phases: ReadonlyArray<{
    readonly phaseId: string;
    readonly title: string;
    readonly status: PrBodyPhaseStatus;
    // How the phase stopped for a person, or null when it never did.
    readonly stop: ReviewedPhase | null;
  }>;
  readonly verifiedSurfaces: readonly RecordedSurface[];
  readonly compliance:
    | { readonly kind: "reviewed"; readonly review: AnyShapeComplianceReview }
    | { readonly kind: "not-reviewed" };
  readonly codeReview:
    | { readonly kind: "reviewed"; readonly review: CodeReview }
    | { readonly kind: "not-reviewed" };
  readonly global: GlobalFileReconciliation;
  // Used only to decide whether a deviation is explained.
  readonly phaseHandoffs: ReadonlyArray<{ readonly phaseId: string; readonly handoffMd: string }>;
  readonly reviewNoteGroups: ReadonlyArray<ReviewNoteGroup>;
  readonly runFolder: { readonly path: string; readonly homeDir: string };
  readonly records: "configured" | "not-configured";
  // The footer's facts; the summary's Plan fact renders the same plan ref.
  readonly footer: PrFooterInput;
  readonly maxBytes?: number;
}

export interface ShortPrBody {
  readonly body: string;
  readonly shortened: boolean;
}

// How many entries of each cuttable list the body keeps.
interface Keep {
  readonly deviations: number;
  readonly attentionPoints: number;
  readonly findings: number;
  readonly notes: number;
}

/**
 * The pull request description of a run: a run summary, one line per phase,
 * what needs a person's review, the review notes and where the full review
 * handoff lives, then the phax footer. Over `maxBytes`, it cuts unexplained
 * deviations first, then attention points, then code review findings, then
 * review notes, and says so
 * just before the footer, which is never cut.
 */
export function buildShortPrBody(input: ShortPrBodyInput): ShortPrBody {
  const maxBytes = input.maxBytes ?? PR_BODY_MAX_BYTES;
  const unexplained = findUnexplainedGlobalDeviations(input.global, input.phaseHandoffs);
  const attentionPoints =
    input.compliance.kind === "reviewed" ? input.compliance.review.attentionPoints : [];
  const findingCount =
    input.codeReview.kind === "reviewed" ? input.codeReview.review.findings.length : 0;
  const noteCount = input.reviewNoteGroups.reduce((n, g) => n + g.notes.length, 0);

  const head = [renderSummary(input), renderPhases(input, unexplained)];
  const fullDetail = renderFullDetail(input);
  const footer = renderPrFooter(input.footer);
  const render = (keep: Keep, shortened: boolean): string => {
    const sections = [
      ...head,
      renderNeedsYourReview(input, unexplained, keep),
      ...(input.reviewNoteGroups.length > 0
        ? [renderNotes(input.reviewNoteGroups, keep.notes, noteCount)]
        : []),
      fullDetail,
    ];
    return `${sections.join("\n\n")}${shortened ? SHORTENED_NOTE : ""}\n\n${footer}`;
  };
  const fits = (keep: Keep): boolean => Buffer.byteLength(render(keep, true), "utf8") <= maxBytes;

  const full = render(
    {
      deviations: unexplained.length,
      attentionPoints: attentionPoints.length,
      findings: findingCount,
      notes: noteCount,
    },
    false,
  );
  if (Buffer.byteLength(full, "utf8") <= maxBytes) {
    return { body: full, shortened: false };
  }

  // Cut order: deviations, then attention points, then code review findings,
  // then notes. Each stage runs only when emptying the lists before it was
  // not enough.
  let keep: Keep = {
    deviations: 0,
    attentionPoints: attentionPoints.length,
    findings: findingCount,
    notes: noteCount,
  };
  if (fits(keep)) {
    keep = {
      ...keep,
      deviations: largestFitting(unexplained.length, (n) => fits({ ...keep, deviations: n })),
    };
  } else {
    keep = { ...keep, attentionPoints: 0 };
    if (fits(keep)) {
      keep = {
        ...keep,
        attentionPoints: largestFitting(attentionPoints.length, (n) =>
          fits({ ...keep, attentionPoints: n }),
        ),
      };
    } else {
      keep = { ...keep, findings: 0 };
      if (fits(keep)) {
        keep = {
          ...keep,
          findings: largestFitting(findingCount, (n) => fits({ ...keep, findings: n })),
        };
      } else {
        // When even no note fits, the never-cut sections alone exceed the cap
        // and the fully cut body is returned as it is.
        const notes = largestFitting(noteCount, (n) => fits({ ...keep, notes: n }));
        keep = { ...keep, notes: Math.max(0, notes) };
      }
    }
  }
  return { body: render(keep, true), shortened: true };
}

// The largest n in [0, total] for which `fits(n)` holds, or -1 when none
// does. Body size grows with each kept entry, so `fits` is monotone.
function largestFitting(total: number, fits: (n: number) => boolean): number {
  let lo = -1;
  let hi = total;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo + 1) / 2);
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function renderSummary(input: ShortPrBodyInput): string {
  const plan = renderPlanRef(input.footer.plan);
  const gateProfile = input.gateProfileId !== undefined ? `\`${input.gateProfileId}\`` : "(none)";
  const spec = input.sourceSpecOutcome?.trim();
  const passed = input.phases.filter((p) => p.status === "passed").length;
  const surfaces = input.verifiedSurfaces.length > 0 ? input.verifiedSurfaces.join(", ") : "none";
  const compliance =
    input.compliance.kind === "reviewed" ? input.compliance.review.verdict : "not reviewed";
  const lines = [
    `**Run** \`${input.qualifiedName}\` · **Plan** ${plan} · **Gate profile** ${gateProfile}`,
    ...(spec !== undefined && spec !== "" ? [`**Spec** ${spec}`] : []),
    `**Phases** ${passed}/${input.phases.length} passed · **Verified surfaces** ${surfaces}`,
    `**Compliance** ${compliance}`,
  ];
  // A trailing backslash is a Markdown hard break: one summary fact per line.
  return lines.join("\\\n");
}

function renderPhases(
  input: ShortPrBodyInput,
  unexplained: ReadonlyArray<UnexplainedDeviation>,
): string {
  const lines = input.phases.map(({ phaseId, title, status, stop }) => {
    const head = `- \`${phaseId}\` ${title} — `;
    if (status === "skipped") return `${head}skipped`;
    const verdict =
      input.compliance.kind === "reviewed"
        ? (input.compliance.review.perPhase.find((p) => p.phaseId === phaseId)?.verdict ??
          "not reviewed")
        : "not reviewed";
    const deviations =
      input.global.unplanned.filter((e) => e.touchedInPhases.includes(phaseId)).length +
      input.global.missing.filter((e) => e.plannedInPhases.includes(phaseId)).length;
    const unexplainedCount = unexplained.filter((d) => d.phaseIds.includes(phaseId)).length;
    const count =
      deviations === 0
        ? "no deviation"
        : `${deviations} ${deviations === 1 ? "deviation" : "deviations"}, ${unexplainedCount} unexplained`;
    return `${head}${verdict} · ${count}${stop === null ? "" : prPhaseStopSuffix(stop)}`;
  });
  return ["## Phases", lines.join("\n")].join("\n\n");
}

function renderNeedsYourReview(
  input: ShortPrBodyInput,
  unexplained: ReadonlyArray<UnexplainedDeviation>,
  keep: Keep,
): string {
  const parts = ["## Needs your review"];
  if (input.compliance.kind === "reviewed") {
    parts.push(
      "### Compliance attention points",
      renderCutList(
        // One bullet each: a line break inside a point would end the list.
        onOneLine(input.compliance.review.attentionPoints).map((p) => `- ${withoutMentions(p)}`),
        keep.attentionPoints,
        ["attention point", "attention points"],
      ),
    );
  }
  if (input.codeReview.kind === "reviewed") {
    parts.push(
      "### Code review findings",
      renderCutList(input.codeReview.review.findings.map(findingLine), keep.findings, [
        "code review finding",
        "code review findings",
      ]),
    );
  }
  parts.push(
    "### Unexplained deviations",
    renderCutList(
      unexplained.map(
        (d) =>
          `- \`${d.path}\` — ${d.kind === "unplanned" ? "unplanned, touched in" : "missing, planned in"} ${d.phaseIds.join(", ")}`,
      ),
      keep.deviations,
      ["unexplained deviation", "unexplained deviations"],
    ),
  );
  return parts.join("\n\n");
}

// One list item per finding. `file` is kept as given, so the code span's
// fence is one backtick longer than the longest run inside it (CommonMark),
// padded with a space on each side when the place holds a backtick.
function findingLine(finding: CodeReviewFinding): string {
  const place = onOneLine(`${finding.file}:${finding.line}`);
  const longestRun = Math.max(0, ...(place.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  const span = longestRun === 0 ? `${fence}${place}${fence}` : `${fence} ${place} ${fence}`;
  return `- **${finding.severity}** ${span} — ${withoutMentions(onOneLine(finding.message))}`;
}

// Model text in the body: `@scope/pkg` or `@name` outside a code span would
// mention a GitHub user or team and notify them, so each such token is
// rendered as code. Code spans and an `@` inside a word (an email) are left
// as they are.
function withoutMentions(text: string): string {
  return text
    .split(/(`+[^`]*?`+)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(
            /(^|[^\w`])(@[\w-]+(?:\/[\w.-]*[\w-])?)/g,
            (_m, before: string, token: string) => `${before}\`${token}\``,
          ),
    )
    .join("");
}

// The first `kept` items, then one line counting the cut ones; `None.` when
// the list was empty to begin with.
function renderCutList(
  items: readonly string[],
  kept: number,
  noun: readonly [singular: string, plural: string],
): string {
  if (items.length === 0) return "None.";
  const lines = items.slice(0, kept);
  const cut = items.length - lines.length;
  if (cut > 0) lines.push(countLine(cut, noun));
  return lines.join("\n");
}

function countLine(cut: number, [singular, plural]: readonly [string, string]): string {
  return `- …and ${cut} more ${cut === 1 ? singular : plural}`;
}

// The review handoff's own rendering of the notes; when shortened, the first
// `kept` notes in render order (a group left without notes is dropped), then
// one line counting the cut ones. The heading and intro always stay.
function renderNotes(groups: ReadonlyArray<ReviewNoteGroup>, kept: number, total: number): string {
  if (kept >= total) return renderReviewNotesSection(groups);
  const keptGroups: ReviewNoteGroup[] = [];
  let left = kept;
  for (const group of groups) {
    if (left === 0) break;
    const notes = group.notes.slice(0, left);
    left -= notes.length;
    keptGroups.push({ owner: group.owner, notes });
  }
  const separator = keptGroups.length > 0 ? "\n" : "\n\n";
  return `${renderReviewNotesSection(keptGroups)}${separator}${countLine(total - kept, ["review note", "review notes"])}`;
}

function renderFullDetail(input: ShortPrBodyInput): string {
  const handoffPath = `${tildePath(input.runFolder.path, input.runFolder.homeDir)}/review-handoff.md`;
  const lines = [
    "## Full detail",
    "The full review handoff (file reconciliation, phase handoffs, compliance review) is in " +
      `the run folder on the machine that ran it: \`${handoffPath}\`. ` +
      `\`phax review-handoff ${input.shortName}\` writes it again.`,
  ];
  if (input.records === "configured") {
    lines.push(
      "A phase commit's prompt, diff, gates and handoff: `phax records explain <commit>`.",
    );
  }
  return lines.join("\n\n");
}

// `path` with the home directory written as `~`, when it lies inside it.
function tildePath(path: string, homeDir: string): string {
  if (path === homeDir) return "~";
  if (path.startsWith(`${homeDir}/`)) return `~${path.slice(homeDir.length)}`;
  return path;
}
