// Shared cases for the acceptance tests of the plan side (lint, extraction and
// the run preflight). A plain module: plan.md builders and the expected findings
// as inline literals, importing nothing from src or tests/helpers.

export type PhaseId = "phase-01" | "phase-02" | "phase-03" | "phase-04";

export const PHASE_IDS: readonly PhaseId[] = ["phase-01", "phase-02", "phase-03", "phase-04"];

/** The file the acceptance phase (phase-03) plans to create. */
export const ACCEPTANCE_FILE = "tests/e2e/publish.test.ts";

const CREATES: Readonly<Record<PhaseId, string>> = {
  "phase-01": "src/a.ts",
  "phase-02": "src/b.ts",
  "phase-03": ACCEPTANCE_FILE,
  "phase-04": "src/publish.ts",
};

/** The anchor each phase heading carries, so a PhaxPlan can point at it. */
export const anchorOf = (id: PhaseId): string => `#${id}`;

/** One expected finding, exactly as lint reports it. */
export interface ExpectedRow {
  readonly severity: "error" | "warning";
  readonly check: string;
  readonly phase: string | null;
  readonly message: string;
}

// ── Header lines ──────────────────────────────────────────────────────────

const NEW_HEADER: readonly string[] = [
  "**Acceptance phase:** passed by phase-04",
  `**Acceptance test files:** \`${ACCEPTANCE_FILE}\``,
];

const DISCHARGED_BY_HEADER: readonly string[] = [
  "**Acceptance phase:** discharged by phase-04",
  `**Acceptance test files:** \`${ACCEPTANCE_FILE}\``,
];

const OLD_HEADER: readonly string[] = [
  "**Oracle phase:** yes",
  `**Oracle files:** \`${ACCEPTANCE_FILE}\``,
];

// ── Test lines ────────────────────────────────────────────────────────────

const IN_PHASE_LINE =
  "- the phase's output is as designed — small · example · the findings · in-phase";

const ACCEPTANCE_LINE =
  "- publishing refuses a red gate — medium · example · the refusal naming the gate · acceptance";

const OLD_LOOP_LINE =
  "- every (state, transition) pair is accepted or refused as the table says — small · table · transition table · oracle · AC-3";

// ── The plan.md builder ───────────────────────────────────────────────────

interface AcceptancePlanOptions {
  /** Extra header lines per phase, right after the effort line. */
  readonly headers?: Partial<Record<PhaseId, readonly string[]>>;
  /** The `### Test strategy` text per phase; an in-phase line when absent. */
  readonly tests?: Partial<Record<PhaseId, string>>;
}

/** A four-phase Draft plan.md; phase-03 plans to create the acceptance file. */
function acceptancePlanMd(opts: AcceptancePlanOptions = {}): string {
  const blocks = PHASE_IDS.map((id, index) => {
    const header = (opts.headers?.[id] ?? []).map((line) => `\n${line}`).join("");
    const tests = opts.tests?.[id] ?? IN_PHASE_LINE;
    return `## ${id} — Phase ${index + 1} {#${id}}

**Recommended model:** claude-sonnet-5-5
**Recommended effort:** medium${header}

### Planned files to create

- ${CREATES[id]}

### Planned files to edit

- (none)

### Optional files that may be edited

- (none)

### Test strategy

${tests}

### Commit subject

feat(publish): part ${index + 1}

### Commit body

Does part ${index + 1}.
`;
  });
  return `---
status: Draft
source-spec: null
---
# Publishing

## Required commands

- (none)

${blocks.join("\n")}`;
}

// ── The plans ─────────────────────────────────────────────────────────────

/** ac-header: phase-03 is an acceptance phase passed by phase-04. */
export const acHeaderPlan = (): string =>
  acceptancePlanMd({
    headers: { "phase-03": NEW_HEADER },
    tests: { "phase-03": ACCEPTANCE_LINE },
  });

/** ac-header-rules, first case: a `discharged by` value. */
export const acHeaderDischargedPlan = (): string =>
  acceptancePlanMd({
    headers: { "phase-03": DISCHARGED_BY_HEADER },
    tests: { "phase-03": ACCEPTANCE_LINE },
  });

/** ac-header-rules, second case: `yes` on phase-02 with no files line. */
export const acHeaderNoFilesPlan = (): string =>
  acceptancePlanMd({
    headers: { "phase-02": ["**Acceptance phase:** yes"] },
    tests: { "phase-02": ACCEPTANCE_LINE },
  });

/** ac-header-old: the Oracle lines on phase-03. */
export const acHeaderOldPlan = (): string =>
  acceptancePlanMd({ headers: { "phase-03": OLD_HEADER } });

/** ac-loop-rules: a misplaced acceptance line, and a silent acceptance phase. */
export const acLoopRulesPlan = (): string =>
  acceptancePlanMd({
    headers: { "phase-03": NEW_HEADER },
    tests: { "phase-02": ACCEPTANCE_LINE, "phase-03": IN_PHASE_LINE },
  });

/** ac-loop-old: phase-03's line is in the retired oracle loop. */
export const acLoopOldPlan = (): string =>
  acceptancePlanMd({ tests: { "phase-03": OLD_LOOP_LINE } });

/** Half rewritten: the test line in the acceptance loop, the Oracle header lines not yet. */
export const halfRewrittenOldHeaderPlan = (): string =>
  acceptancePlanMd({
    headers: { "phase-03": OLD_HEADER },
    tests: { "phase-03": ACCEPTANCE_LINE },
  });

/** Half rewritten: the new header lines, the test line still in the oracle loop. */
export const halfRewrittenOldLoopPlan = (): string =>
  acceptancePlanMd({
    headers: { "phase-03": NEW_HEADER },
    tests: { "phase-03": OLD_LOOP_LINE },
  });

// ── The expected findings ─────────────────────────────────────────────────

const acceptanceRow = (phase: string, message: string): ExpectedRow => ({
  severity: "error",
  check: "acceptance",
  phase,
  message,
});

const testsRow = (phase: string, message: string): ExpectedRow => ({
  severity: "error",
  check: "tests",
  phase,
  message,
});

export const DISCHARGED_BY_ROW = acceptanceRow(
  "phase-03",
  '**Acceptance phase:** "discharged by phase-04" is not a declaration: write "yes" or "passed by phase-NN"',
);

export const NO_FILES_ROW = acceptanceRow(
  "phase-02",
  "**Acceptance phase:** without **Acceptance test files:**: write both lines or neither",
);

export const OLD_PHASE_ROW = acceptanceRow(
  "phase-03",
  "**Oracle phase:** is no longer read: write **Acceptance phase:**",
);

export const OLD_FILES_ROW = acceptanceRow(
  "phase-03",
  "**Oracle files:** is no longer read: write **Acceptance test files:**",
);

export const MISPLACED_ROW = testsRow(
  "phase-02",
  "test line 1 is in the acceptance loop, but phase-02 is not an acceptance phase",
);

export const SILENT_ROW = testsRow(
  "phase-03",
  "phase-03 is an acceptance phase, but none of its test lines is in the acceptance loop",
);

export const OLD_LOOP_MESSAGE =
  "test line 1 uses the loop 'oracle', which is no longer read: write 'acceptance'";

export const OLD_LOOP_ROW = testsRow("phase-03", OLD_LOOP_MESSAGE);

export const NO_PROVIDER_ROW = acceptanceRow(
  "phase-03",
  'acceptance phase declared, but no "acceptance" provider is configured (phax.json, phax.local.json or ~/.phax/config.json)',
);
