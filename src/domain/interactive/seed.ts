// The seed of a stop, declared or held: what a person (or any agent they
// open) reads first in the stopped phase's worktree. phax writes it to
// `.phax-context/interactive-review.md` and to the phase's run folder. Pure.

interface SeedPhaseText {
  readonly id: string;
  readonly title: string;
  readonly text: string;
}

export interface DeclaredSeedInput {
  readonly shortName: string;
  readonly phaseId: string;
  readonly phaseTitle: string;
  /** The phase's own Detailed instructions, verbatim. */
  readonly detailedInstructions: string;
  /** The executed phases' handoffs, in plan order. */
  readonly executed: readonly SeedPhaseText[];
  /** The upcoming phases' plan sections, in plan order. */
  readonly upcoming: readonly SeedPhaseText[];
  readonly gateCommands: readonly string[];
  /** The command that closes the phase, run from the main checkout. */
  readonly closeCommand: string;
}

export interface HeldSeedInput {
  readonly shortName: string;
  readonly phaseId: string;
  readonly phaseTitle: string;
  /** The phase's located plan.md section, verbatim. */
  readonly planSection: string;
  /** The phase's validated handoff (`phase-handoff.md`). */
  readonly handoff: string;
  /** The phase's `file-reconciliation.md`. */
  readonly reconciliation: string;
  /** The phase's base, a full sha. */
  readonly base: string;
  /** The phase's commit, a full sha. */
  readonly phaseCommit: string;
  /** The earlier phases' handoffs, in plan order. */
  readonly earlier: readonly SeedPhaseText[];
  /** The upcoming phases' plan sections, in plan order. */
  readonly upcoming: readonly SeedPhaseText[];
  readonly gateCommands: readonly string[];
  /** The command that closes the phase, run from the main checkout. */
  readonly closeCommand: string;
}

/** The path the seed points to for the whole plan, inside every phase worktree. */
const SEED_PLAN_PATH = ".phax-context/plan.md";

// What every review asks of the person after its first line.
const EXPECTED_OF_EVERY_REVIEW: readonly string[] = [
  "- Turn each correction into a guard where you can: a test, a lint rule or a gate step.",
  "- Keep the scope: correct what was done; do not do the later phases' work.",
  "- Optional: write .phax-context/correction-handoff.md yourself, with these sections in this order:",
  "  `## What was corrected`, `## The pattern to follow from now on`, `## Guards` (one entry per",
  "  correction, in order: the test, lint rule or gate step that guards it, or `no guard: <reason>`)",
  "  and `## What the next phases need to know`. Otherwise phax writes the handoff when you resume.",
];

function joinNames(ids: readonly string[]): string {
  if (ids.length <= 1) return ids.join("");
  return `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1] ?? ""}`;
}

function whyHere(input: DeclaredSeedInput): string {
  const later = input.upcoming.map((p) => p.id);
  const lead = "The run stopped here because its plan declares this phase interactive.";
  if (later.length === 0) return `${lead} No phase follows it.`;
  return `${lead} ${joinNames(later)} start${later.length === 1 ? "s" : ""} from what you leave here: correct the pattern once, here.`;
}

const short = (sha: string): string => sha.slice(0, 7);

function section(heading: string, body: string): string[] {
  return [heading, body.trim().length === 0 ? "(empty)" : body.trimEnd(), ""];
}

// The earlier phases' handoffs, each under its own heading.
function handoffLines(phases: readonly SeedPhaseText[]): string[] {
  if (phases.length === 0) return ["No phase has run before this one.", ""];
  return phases.flatMap((p) => [`### ${p.id} — ${p.title} — handoff`, p.text.trimEnd(), ""]);
}

// The upcoming phases' plan sections, the full plan's path, the gate and the
// close: the tail both seeds end with.
function closingLines(
  upcoming: readonly SeedPhaseText[],
  gateCommands: readonly string[],
  closeCommand: string,
): string[] {
  return [
    "## Upcoming phases (their plan sections)",
    ...(upcoming.length === 0
      ? ["No phase follows this one.", ""]
      : upcoming.flatMap((p) => [`### ${p.id} — ${p.title}`, p.text.trimEnd(), ""])),
    `Full plan: ${SEED_PLAN_PATH}`,
    "",
    "## Gate",
    ...(gateCommands.length === 0 ? ["(no gate commands)"] : gateCommands),
    "",
    "## Close the phase",
    "From the main checkout, not from this worktree:",
    `  ${closeCommand}`,
    "",
  ];
}

/**
 * The markdown of a declared stop's seed: why the run stopped, what is
 * expected of the person, the phase's own instructions, every executed
 * phase's handoff, the upcoming phases' plan sections, the path of the full
 * plan, the gate, and the command that closes the phase.
 */
export function buildDeclaredSeed(input: DeclaredSeedInput): string {
  const lines: string[] = [
    `# Interactive review: ${input.phaseId} of ${input.shortName}`,
    "",
    whyHere(input),
    "",
    "## What is expected of you",
    "- Correct the pattern in this worktree: the later phases start from this code.",
    ...EXPECTED_OF_EVERY_REVIEW,
    "",
    ...section(
      `## What to review (plan, ${input.phaseId} — ${input.phaseTitle})`,
      input.detailedInstructions,
    ),
    "## Executed phases",
    ...handoffLines(input.executed),
    ...closingLines(input.upcoming, input.gateCommands, input.closeCommand),
  ];
  return lines.join("\n");
}

/**
 * The markdown of a held stop's seed: why the run stopped (with the phase
 * commit and its base), what is expected of the person, the phase's plan
 * section, its handoff and its file reconciliation, every earlier phase's
 * handoff, the upcoming phases' plan sections, the path of the full plan,
 * the gate, and the command that closes the phase.
 */
export function buildHeldSeed(input: HeldSeedInput): string {
  const lines: string[] = [
    `# Held for review: ${input.phaseId} of ${input.shortName}`,
    "",
    `The run stopped here because it was started with --hold. ${input.phaseId} (${input.phaseTitle}) is committed`,
    `(${short(input.phaseCommit)}, on ${short(input.base)}); the later phases have not started and will build on what you leave here.`,
    "",
    "## What is expected of you",
    `- Review ${input.phaseId}'s work; correct it in this worktree, on top of its commit.`,
    `- Leave your corrections uncommitted: phax commits them when you resume, and a commit of your own on ${short(input.phaseCommit)} is refused at the first close.`,
    ...EXPECTED_OF_EVERY_REVIEW,
    "",
    ...section(`## The phase (plan, ${input.phaseId})`, input.planSection),
    ...section("## What it delivered (its handoff)", input.handoff),
    ...section("## Its files (reconciliation)", input.reconciliation),
    "## Earlier phases",
    ...handoffLines(input.earlier),
    ...closingLines(input.upcoming, input.gateCommands, input.closeCommand),
  ];
  return lines.join("\n");
}
