import { Brand, Either, ParseResult, Schema } from "effect";

type ParseError = ParseResult.ParseError;

export type ShortName = string & Brand.Brand<"ShortName">;
const ShortNameSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(64),
  Schema.pattern(/^[a-z][a-z0-9-]*$/),
  Schema.brand("ShortName"),
);
export const decodeShortName = (u: unknown): Either.Either<ShortName, ParseError> =>
  Schema.decodeUnknownEither(ShortNameSchema)(u);

export type RunId = string & Brand.Brand<"RunId">;
const RunIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("RunId"));
export const decodeRunId = (u: unknown): Either.Either<RunId, ParseError> =>
  Schema.decodeUnknownEither(RunIdSchema)(u);

export type PhaseId = string & Brand.Brand<"PhaseId">;
const PhaseIdSchema = Schema.String.pipe(Schema.pattern(/^phase-\d{2}$/), Schema.brand("PhaseId"));
export const decodePhaseId = (u: unknown): Either.Either<PhaseId, ParseError> =>
  Schema.decodeUnknownEither(PhaseIdSchema)(u);

export type BranchName = string & Brand.Brand<"BranchName">;
export const BranchNameSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("BranchName"));
export const decodeBranchName = (u: unknown): Either.Either<BranchName, ParseError> =>
  Schema.decodeUnknownEither(BranchNameSchema)(u);

export type WorktreePath = string & Brand.Brand<"WorktreePath">;
const WorktreePathSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("WorktreePath"));
export const decodeWorktreePath = (u: unknown): Either.Either<WorktreePath, ParseError> =>
  Schema.decodeUnknownEither(WorktreePathSchema)(u);

export type ClaudeSessionId = string & Brand.Brand<"ClaudeSessionId">;
const ClaudeSessionIdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand("ClaudeSessionId"),
);
export const decodeClaudeSessionId = (u: unknown): Either.Either<ClaudeSessionId, ParseError> =>
  Schema.decodeUnknownEither(ClaudeSessionIdSchema)(u);

export type GateProfileId = string & Brand.Brand<"GateProfileId">;
const GateProfileIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("GateProfileId"));
export const decodeGateProfileId = (u: unknown): Either.Either<GateProfileId, ParseError> =>
  Schema.decodeUnknownEither(GateProfileIdSchema)(u);

export type WorkspaceId = string & Brand.Brand<"WorkspaceId">;
const WorkspaceIdSchema = Schema.String.pipe(Schema.minLength(1), Schema.brand("WorkspaceId"));
export const decodeWorkspaceId = (u: unknown): Either.Either<WorkspaceId, ParseError> =>
  Schema.decodeUnknownEither(WorkspaceIdSchema)(u);
