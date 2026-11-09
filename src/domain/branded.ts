import { Brand, Result, Schema } from "effect";
import { isExportedPattern } from "../schemas/strictString.js";

type ParseError = Schema.SchemaError;

export type Namespace = string & Brand.Brand<"Namespace">;
const NamespaceSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  isExportedPattern(/^[a-z][a-z0-9-]*$/),
).pipe(Schema.brand("Namespace"));
export const decodeNamespace = (u: unknown): Result.Result<Namespace, ParseError> =>
  Schema.decodeUnknownResult(NamespaceSchema, { reportInput: true })(u);

export type ShortName = string & Brand.Brand<"ShortName">;
const ShortNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  isExportedPattern(/^[a-z][a-z0-9-]*$/),
).pipe(Schema.brand("ShortName"));
export const decodeShortName = (u: unknown): Result.Result<ShortName, ParseError> =>
  Schema.decodeUnknownResult(ShortNameSchema, { reportInput: true })(u);

/**
 * Normalize arbitrary text into a valid ShortName slug. The model is asked for a
 * shortName but routinely returns prose (often the plan title), so we never
 * trust it: lowercase, strip diacritics, collapse non-alphanumerics into single
 * hyphens, drop any leading non-letters (the brand requires `^[a-z]`), and trim
 * to 64 chars. Returns "" when nothing usable remains so callers can fall back.
 */
export function slugifyShortName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
}

export type RunId = string & Brand.Brand<"RunId">;
const RunIdSchema = Schema.String.check(Schema.isMinLength(1)).pipe(Schema.brand("RunId"));
export const decodeRunId = (u: unknown): Result.Result<RunId, ParseError> =>
  Schema.decodeUnknownResult(RunIdSchema, { reportInput: true })(u);

export type PhaseId = string & Brand.Brand<"PhaseId">;
const PhaseIdSchema = Schema.String.check(isExportedPattern(/^phase-\d{2}$/)).pipe(
  Schema.brand("PhaseId"),
);
export const decodePhaseId = (u: unknown): Result.Result<PhaseId, ParseError> =>
  Schema.decodeUnknownResult(PhaseIdSchema, { reportInput: true })(u);

function isSafeBranchName(s: string): boolean {
  if (s.length === 0 || s[0] === "-") return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    // Reject ASCII control characters (0x00-0x1f), space (0x20), and DEL (0x7f).
    if (c <= 0x20 || c === 0x7f) return false;
  }
  return true;
}

export type BranchName = string & Brand.Brand<"BranchName">;
// Rejects empty, leading `-` (arg-injection vector), and ASCII whitespace/controls.
// Accepts all other chars including `/`, `.`, and `-` in non-leading position.
// The JSON Schema pattern accepts exactly what `isSafeBranchName` accepts.
export const BranchNameSchema = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(255),
  Schema.makeFilter(isSafeBranchName, {
    message: "branch name must not start with '-' or contain whitespace/control characters",
    toJsonSchema: () => ({ pattern: "^[^\\x00-\\x20\\x7f-][^\\x00-\\x20\\x7f]*$" }),
  }),
).pipe(Schema.brand("BranchName"));
export const decodeBranchName = (u: unknown): Result.Result<BranchName, ParseError> =>
  Schema.decodeUnknownResult(BranchNameSchema, { reportInput: true })(u);

export type WorktreePath = string & Brand.Brand<"WorktreePath">;
const WorktreePathSchema = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("WorktreePath"),
);
export const decodeWorktreePath = (u: unknown): Result.Result<WorktreePath, ParseError> =>
  Schema.decodeUnknownResult(WorktreePathSchema, { reportInput: true })(u);

export type ClaudeSessionId = string & Brand.Brand<"ClaudeSessionId">;
const ClaudeSessionIdSchema = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("ClaudeSessionId"),
);
export const decodeClaudeSessionId = (u: unknown): Result.Result<ClaudeSessionId, ParseError> =>
  Schema.decodeUnknownResult(ClaudeSessionIdSchema, { reportInput: true })(u);

export type GateProfileId = string & Brand.Brand<"GateProfileId">;
const GateProfileIdSchema = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("GateProfileId"),
);
export const decodeGateProfileId = (u: unknown): Result.Result<GateProfileId, ParseError> =>
  Schema.decodeUnknownResult(GateProfileIdSchema, { reportInput: true })(u);

export type WorkspaceId = string & Brand.Brand<"WorkspaceId">;
const WorkspaceIdSchema = Schema.String.check(Schema.isMinLength(1)).pipe(
  Schema.brand("WorkspaceId"),
);
export const decodeWorkspaceId = (u: unknown): Result.Result<WorkspaceId, ParseError> =>
  Schema.decodeUnknownResult(WorkspaceIdSchema, { reportInput: true })(u);
