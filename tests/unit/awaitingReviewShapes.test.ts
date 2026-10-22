import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { composePhaxState } from "../../src/app/phaxState.js";
import {
  currentSchemaUrl,
  readPhaseStatusFile,
  readRegistryFile,
  readRunStatusFile,
} from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";
import { phaseStatus, phaseStatusFile } from "../helpers/phaseStatusFixture.js";

const at = "2026-10-22T09:30:00.000Z";
const base = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const fields = {
  phaseId: "phase-03",
  phaseIndex: 2,
  state: "running",
  model: "claude-opus-5-5",
  effort: "high",
  branchName: "phax/invoice-export--phase-03",
  base,
  worktreePath: "/example/worktrees/invoice-export/phase-03",
  createdAt: at,
  updatedAt: at,
} as const;

const runStatus = {
  namespace: "example",
  shortName: "invoice-export",
  runId: "invoice-export-2026-10-22",
  state: "running",
  createdAt: at,
  updatedAt: at,
  phasesCount: 4,
  currentPhaseIndex: 2,
};

const registryEntry = {
  namespace: "example",
  shortName: "invoice-export",
  runId: "invoice-export-2026-10-22",
  state: "running",
  branch: "phax/invoice-export",
  projectName: "example",
  phasesCount: 4,
  createdAt: at,
  updatedAt: at,
};

function message(result: Either.Either<unknown, { readonly message: string }>): string {
  return Either.isLeft(result) ? result.left.message : "";
}

describe("phase status readers", () => {
  it("lifts a 0.20.0 status as a headless phase that never stopped", () => {
    const document = { $schema: schemaUrl("phase-status", "0.20.0"), ...fields };
    expect(readPhaseStatusFile("status.json", document)).toEqual(
      Either.right(phaseStatus({ ...fields, mode: "headless", stop: null })),
    );
  });

  it("refuses a 0.20.0 status already at awaiting_review, a state no earlier phax wrote", () => {
    const document = {
      $schema: schemaUrl("phase-status", "0.20.0"),
      ...fields,
      state: "awaiting_review",
    };
    expect(Either.isLeft(readPhaseStatusFile("status.json", document))).toBe(true);
  });

  it.each([
    ["waiting", { cause: "declared", status: "waiting" }],
    ["closed corrected", { cause: "declared", status: "closed", outcome: "corrected" }],
    ["closed unchanged", { cause: "declared", status: "closed", outcome: "unchanged" }],
  ] as const)("round-trips a current status with a %s stop", (_name, stop) => {
    const document = phaseStatusFile({
      ...fields,
      state: stop.status === "waiting" ? "awaiting_review" : "committed",
      mode: "interactive",
      stop,
    });
    const read = readPhaseStatusFile("status.json", JSON.parse(JSON.stringify(document)));
    const { $schema: _schema, ...status } = document;
    expect(read).toEqual(Either.right(status));
  });

  it.each([
    ["no stop", null],
    ["a closed stop", { cause: "declared", status: "closed", outcome: "corrected" }],
  ] as const)("refuses a current status awaiting review with %s", (_name, stop) => {
    const document = phaseStatusFile({
      ...fields,
      state: "awaiting_review",
      mode: "interactive",
      stop,
    });
    expect(message(readPhaseStatusFile("status.json", JSON.parse(JSON.stringify(document))))).toBe(
      "status.json: a phase awaiting review records no waiting stop",
    );
  });

  it("refuses a stop with an unknown cause", () => {
    const document = {
      ...phaseStatusFile({ ...fields, state: "awaiting_review", mode: "interactive" }),
      stop: { cause: "held", status: "waiting" },
    };
    expect(Either.isLeft(readPhaseStatusFile("status.json", document))).toBe(true);
  });

  it("refuses a closed stop without its outcome", () => {
    const document = {
      ...phaseStatusFile({ ...fields, state: "committed", mode: "interactive" }),
      stop: { cause: "declared", status: "closed" },
    };
    expect(Either.isLeft(readPhaseStatusFile("status.json", document))).toBe(true);
  });

  it("refuses a current status without mode or stop", () => {
    const { mode: _mode, ...noMode } = phaseStatusFile(fields);
    expect(message(readPhaseStatusFile("status.json", noMode))).toContain("mode");
    const { stop: _stop, ...noStop } = phaseStatusFile(fields);
    expect(message(readPhaseStatusFile("status.json", noStop))).toContain("stop");
  });

  it("still refuses a status without base, at the frozen stamp or before $schema", () => {
    const { base: _base, ...noBase } = fields;
    const older = { $schema: schemaUrl("phase-status", "0.17.0"), ...noBase };
    expect(message(readPhaseStatusFile("status.json", older))).toContain("base");
    const preSchema = { version: 1, ...noBase };
    expect(Either.isLeft(readPhaseStatusFile("status.json", preSchema))).toBe(true);
  });
});

describe("composePhaxState at a stop", () => {
  it("reads the stopped phase's cause from its stop", () => {
    const stopped = phaseStatus({
      ...fields,
      state: "awaiting_review",
      mode: "interactive",
      stop: { cause: "declared", status: "waiting" },
    });
    expect(composePhaxState("running", undefined, stopped)).toEqual({
      run: "running",
      phase: { state: "awaiting_review", cause: "declared" },
    });
  });

  it("refuses a phase awaiting review with no stop instead of defaulting its cause", () => {
    const stopped = phaseStatus({
      ...fields,
      state: "awaiting_review",
      mode: "interactive",
      stop: null,
    });
    expect(() => composePhaxState("awaiting_review", undefined, stopped)).toThrow(
      "Phase phase-03 is awaiting review with no stop recorded",
    );
  });
});

describe("run status readers", () => {
  it("reads a 0.17.0 run status unchanged", () => {
    const document = { $schema: schemaUrl("run-status", "0.17.0"), ...runStatus };
    expect(readRunStatusFile("run-status.json", document)).toEqual(Either.right(runStatus));
  });

  it("refuses a 0.17.0 run status at awaiting_review", () => {
    const document = {
      $schema: schemaUrl("run-status", "0.17.0"),
      ...runStatus,
      state: "awaiting_review",
    };
    expect(Either.isLeft(readRunStatusFile("run-status.json", document))).toBe(true);
  });

  it("reads a current run status at awaiting_review", () => {
    const status = { ...runStatus, state: "awaiting_review", stoppedReason: "awaiting_review" };
    const document = { $schema: currentSchemaUrl("run-status"), ...status };
    expect(readRunStatusFile("run-status.json", document)).toEqual(Either.right(status));
  });
});

describe("registry readers", () => {
  it("reads a 0.17.0 registry unchanged", () => {
    const document = { $schema: schemaUrl("registry", "0.17.0"), runs: [registryEntry] };
    expect(readRegistryFile("registry.json", document)).toEqual(
      Either.right({ runs: [registryEntry] }),
    );
  });

  it("reads a current registry with a run awaiting review", () => {
    const runs = [{ ...registryEntry, state: "awaiting_review" }];
    const document = { $schema: currentSchemaUrl("registry"), runs };
    expect(readRegistryFile("registry.json", document)).toEqual(Either.right({ runs }));
  });
});
