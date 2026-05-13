import type {
  BranchName,
  PhaseId,
  RunId,
  ShortName,
  WorktreePath,
} from "../../src/domain/branded.js";

declare const shortName: ShortName;
declare const runId: RunId;
declare const branchName: BranchName;

// Branded types are still strings — these assignments are legal
const asString1: string = shortName;
const asString2: string = runId;
const asString3: string = branchName;

// Plain strings cannot be assigned to branded types without the brand
// @ts-expect-error: string literal is not assignable to ShortName
const badShortName: ShortName = "my-run";

// @ts-expect-error: string literal is not assignable to RunId
const badRunId: RunId = "some-id";

// @ts-expect-error: string literal is not assignable to PhaseId
const badPhaseId: PhaseId = "phase-01";

// @ts-expect-error: string literal is not assignable to BranchName
const badBranchName: BranchName = "main";

// @ts-expect-error: string literal is not assignable to WorktreePath
const badWorktreePath: WorktreePath = "/some/path";

// Branded types are not interchangeable even though both extend string
// @ts-expect-error: ShortName is not assignable to RunId (brands differ)
const shortNameAsRunId: RunId = shortName;

// @ts-expect-error: RunId is not assignable to PhaseId
const runIdAsPhaseId: PhaseId = runId;

// @ts-expect-error: BranchName is not assignable to WorktreePath
const branchAsPath: WorktreePath = branchName;

// Suppress unused-variable lint for the legal-use variables above
void asString1;
void asString2;
void asString3;
void badShortName;
void badRunId;
void badPhaseId;
void badBranchName;
void badWorktreePath;
void shortNameAsRunId;
void runIdAsPhaseId;
void branchAsPath;
