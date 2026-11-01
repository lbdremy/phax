// The cases of the acceptance tests for the record and status lifts: inline literal
// documents, each with the value phax's reader and the schemas package must give
// once run-status, phase-status, gate-attribution and phase-record-manifest are at
// 0.33.0. No fixture helper is imported: tests/helpers/*Fixture.ts change in the
// phase that passes these tests.

export type LiftFormat =
  | "run-status"
  | "phase-status"
  | "gate-attribution"
  | "phase-record-manifest";

const url = (format: LiftFormat, release: string): string =>
  `https://docs.phax.run/schemas/${format}/${release}.json`;

export interface LiftCase {
  readonly label: string;
  readonly format: LiftFormat;
  /** The document as an older phax wrote it, with its `$schema` URL written out. */
  readonly input: Readonly<Record<string, unknown>>;
  /** The in-memory value the reader gives: no `$schema`, the acceptance names. */
  readonly expected: Readonly<Record<string, unknown>>;
}

export interface StampCase {
  readonly label: string;
  readonly format: LiftFormat;
  /** A 0.33.0 document carrying the acceptance names. */
  readonly written: Readonly<Record<string, unknown>>;
  /** The value `written` reads as. */
  readonly expected: Readonly<Record<string, unknown>>;
  /** A 0.33.0 document carrying the oracle names: refused. */
  readonly refused: Readonly<Record<string, unknown>>;
}

const runStatusFields = {
  namespace: "example",
  shortName: "example-run",
  runId: "run-0001",
  state: "running",
  createdAt: "2026-01-01T09:00:00.000Z",
  updatedAt: "2026-01-01T09:30:00.000Z",
  phasesCount: 4,
  currentPhaseIndex: 2,
  gateProfileId: "standard",
};

const phaseStatusFields = {
  phaseId: "phase-03",
  phaseIndex: 2,
  state: "committed",
  model: "example-model",
  effort: "high",
  createdAt: "2026-01-01T09:00:00.000Z",
  updatedAt: "2026-01-01T09:30:00.000Z",
  branchName: "phax/example-run--phase-03",
  base: "0123456789abcdef0123456789abcdef01234567",
  worktreePath: "/work/example-repo/worktrees/phase-03",
  mode: "headless",
};

const closedBy = { name: "Ada Example", email: "ada@example.com" };
const reviewCommit = "89abcdef0123456789abcdef0123456789abcdef";

const manifestFields = {
  runId: "run-0001",
  phaseId: "phase-03",
  shape: "full",
  sourceSha: "abc1234",
  model: "example-model",
  effort: "high",
  provider: "claude-code",
  outcome: "committed",
  usage: { available: false },
  mode: "headless",
  stop: null,
};

export const liftCases: ReadonlyArray<LiftCase> = [
  {
    label: "run-status 0.26.0 holding the oracle phases",
    format: "run-status",
    input: {
      $schema: url("run-status", "0.26.0"),
      ...runStatusFields,
      hold: { selection: "oracle", phases: ["phase-03"] },
    },
    expected: { ...runStatusFields, hold: { selection: "acceptance", phases: ["phase-03"] } },
  },
  {
    label: "phase-status 0.26.0, held stop closed with the authored oracle step",
    format: "phase-status",
    input: {
      $schema: url("phase-status", "0.26.0"),
      ...phaseStatusFields,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit,
        oracleStep: "authored",
        closedBy,
      },
    },
    expected: {
      ...phaseStatusFields,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit,
        acceptanceStep: "authored",
        closedBy,
      },
    },
  },
  {
    label: "phase-status 0.26.0, held stop closed with no oracle step",
    format: "phase-status",
    input: {
      $schema: url("phase-status", "0.26.0"),
      ...phaseStatusFields,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit,
        oracleStep: "none",
        closedBy,
      },
    },
    expected: {
      ...phaseStatusFields,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit,
        acceptanceStep: "none",
        closedBy,
      },
    },
  },
  {
    label: "gate-attribution 0.31.0 with a passing oracle step",
    format: "gate-attribution",
    input: {
      $schema: url("gate-attribution", "0.31.0"),
      phase: "phase-03",
      steps: [
        { command: "pnpm typecheck", surface: "structural", result: "pass" },
        { command: "oracles", surface: "oracle", result: "pass" },
      ],
      protectedPaths: null,
    },
    expected: {
      phase: "phase-03",
      steps: [
        { command: "pnpm typecheck", surface: "structural", result: "pass" },
        { command: "oracles", surface: "acceptance", result: "pass" },
      ],
      protectedPaths: null,
    },
  },
  {
    label: "gate-attribution 0.31.0 with a skipped oracle step",
    format: "gate-attribution",
    input: {
      $schema: url("gate-attribution", "0.31.0"),
      phase: "phase-03",
      steps: [
        { command: "pnpm test", surface: "local", result: "fail" },
        { command: "oracles", surface: "oracle", result: "skipped" },
      ],
      protectedPaths: null,
    },
    expected: {
      phase: "phase-03",
      steps: [
        { command: "pnpm test", surface: "local", result: "fail" },
        { command: "oracles", surface: "acceptance", result: "skipped" },
      ],
      protectedPaths: null,
    },
  },
  {
    label: "gate-attribution 0.26.0 with an oracle step",
    format: "gate-attribution",
    input: {
      $schema: url("gate-attribution", "0.26.0"),
      phase: "phase-03",
      steps: [
        { command: "pnpm typecheck", surface: "structural", result: "pass" },
        { command: "oracles", surface: "oracle", result: "fail" },
      ],
    },
    expected: {
      phase: "phase-03",
      steps: [
        { command: "pnpm typecheck", surface: "structural", result: "pass" },
        { command: "oracles", surface: "acceptance", result: "fail" },
      ],
      protectedPaths: null,
    },
  },
  {
    label: "phase-record-manifest 0.30.0 of an oracle phase",
    format: "phase-record-manifest",
    input: {
      $schema: url("phase-record-manifest", "0.30.0"),
      ...manifestFields,
      verifiedSurfaces: ["local", "oracle"],
      oracle: { role: "oracle", dischargedBy: "phase-04" },
    },
    expected: {
      ...manifestFields,
      verifiedSurfaces: ["acceptance", "local"],
      acceptance: { role: "acceptance", passedBy: "phase-04" },
    },
  },
  {
    label: "phase-record-manifest 0.30.0 of a discharging phase",
    format: "phase-record-manifest",
    input: {
      $schema: url("phase-record-manifest", "0.30.0"),
      ...manifestFields,
      phaseId: "phase-04",
      verifiedSurfaces: ["local", "oracle"],
      oracle: { role: "discharging", oraclePhase: "phase-03" },
    },
    expected: {
      ...manifestFields,
      phaseId: "phase-04",
      verifiedSurfaces: ["acceptance", "local"],
      acceptance: { role: "passing", acceptancePhase: "phase-03" },
    },
  },
  {
    label: "phase-record-manifest 0.30.0 with no oracle role",
    format: "phase-record-manifest",
    input: {
      $schema: url("phase-record-manifest", "0.30.0"),
      ...manifestFields,
      verifiedSurfaces: ["local", "structural"],
      oracle: null,
    },
    expected: {
      ...manifestFields,
      verifiedSurfaces: ["local", "structural"],
      acceptance: null,
    },
  },
  {
    label: "phase-record-manifest 0.26.0 of an oracle phase",
    format: "phase-record-manifest",
    input: {
      $schema: url("phase-record-manifest", "0.26.0"),
      ...manifestFields,
      verifiedSurfaces: ["structural", "oracle"],
      oracle: { role: "oracle", dischargedBy: "phase-04" },
    },
    expected: {
      ...manifestFields,
      verifiedSurfaces: ["acceptance", "structural"],
      acceptance: { role: "acceptance", passedBy: "phase-04" },
    },
  },
];

export const stampCases: ReadonlyArray<StampCase> = [
  {
    label: "run-status 0.33.0",
    format: "run-status",
    written: {
      $schema: url("run-status", "0.33.0"),
      ...runStatusFields,
      hold: { selection: "acceptance", phases: ["phase-03"] },
    },
    expected: { ...runStatusFields, hold: { selection: "acceptance", phases: ["phase-03"] } },
    refused: {
      $schema: url("run-status", "0.33.0"),
      ...runStatusFields,
      hold: { selection: "oracle", phases: ["phase-03"] },
    },
  },
  {
    label: "phase-status 0.33.0",
    format: "phase-status",
    written: {
      $schema: url("phase-status", "0.33.0"),
      ...phaseStatusFields,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit,
        acceptanceStep: "authored",
        closedBy,
      },
    },
    expected: {
      ...phaseStatusFields,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit,
        acceptanceStep: "authored",
        closedBy,
      },
    },
    refused: {
      $schema: url("phase-status", "0.33.0"),
      ...phaseStatusFields,
      stop: {
        cause: "held",
        status: "closed",
        outcome: "corrected",
        reviewCommit,
        oracleStep: "authored",
        closedBy,
      },
    },
  },
  {
    label: "gate-attribution 0.33.0",
    format: "gate-attribution",
    written: {
      $schema: url("gate-attribution", "0.33.0"),
      phase: "phase-03",
      steps: [
        { command: "pnpm typecheck", surface: "structural", result: "pass" },
        { command: "acceptance", surface: "acceptance", result: "pass" },
      ],
      protectedPaths: null,
    },
    expected: {
      phase: "phase-03",
      steps: [
        { command: "pnpm typecheck", surface: "structural", result: "pass" },
        { command: "acceptance", surface: "acceptance", result: "pass" },
      ],
      protectedPaths: null,
    },
    refused: {
      $schema: url("gate-attribution", "0.33.0"),
      phase: "phase-03",
      steps: [
        { command: "pnpm typecheck", surface: "structural", result: "pass" },
        { command: "oracles", surface: "oracle", result: "pass" },
      ],
      protectedPaths: null,
    },
  },
  {
    label: "phase-record-manifest 0.33.0",
    format: "phase-record-manifest",
    written: {
      $schema: url("phase-record-manifest", "0.33.0"),
      ...manifestFields,
      verifiedSurfaces: ["acceptance", "local"],
      acceptance: { role: "passing", acceptancePhase: "phase-03" },
    },
    expected: {
      ...manifestFields,
      verifiedSurfaces: ["acceptance", "local"],
      acceptance: { role: "passing", acceptancePhase: "phase-03" },
    },
    refused: {
      $schema: url("phase-record-manifest", "0.33.0"),
      ...manifestFields,
      verifiedSurfaces: ["local", "oracle"],
      oracle: { role: "discharging", oraclePhase: "phase-03" },
    },
  },
];
