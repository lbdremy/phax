// The corpus's subject adapter: the one corpus module that touches Effect, and
// the only one a later plan migrates. `replay(subject, input)` decodes the input
// as phax's call site does and renders a refusal with the formatter that call
// site uses: the line(s) phax derives from the decode, without the file path
// or message prefix the call site wraps around them. A decoded value is
// normalised to plain data (an Effect `Option` becomes `{ _tag, value }`) so
// the canonical encoder never sees an Effect class.
import { Either, Option, type ParseResult } from "effect";
import { decodePhaxConfig, decodePhaxUserOverlay } from "../../src/schemas/phaxConfig.js";
import { decodeProviderConfig } from "../../src/schemas/providerConfig.js";
import { decodeModelRouting } from "../../src/schemas/modelRouting.js";
import { decodeTelemetryConfig } from "../../src/schemas/telemetryConfig.js";
import { extractBaseModel } from "../../src/schemas/vibeConfig.js";
import { scanClaudeOutcomeEvents } from "../../src/schemas/claudeOutput.js";
import { parseClaudeStream } from "../../src/schemas/claudeStream.js";
import { scanCodexOutcomeEvents } from "../../src/schemas/codexOutput.js";
import { findVibeResultEvent, findVibeStreamHead } from "../../src/schemas/vibeOutput.js";
import { decodeVibeExportText, decodeVibeOutcomeText } from "../../src/schemas/vibeExport.js";
import { readPlanExtractionAnswer } from "../../src/schemas/planExtraction.js";
import { decodeAuthoredSpecDocument } from "../../src/schemas/specDocument.js";
import { decodeAuthoredPlanDocument } from "../../src/schemas/planDocument.js";
import { decodePlanAuditResponse } from "../../src/schemas/planAudit.js";
import {
  decodePlanFrontmatter,
  decodeSpecFrontmatter,
} from "../../src/schemas/artifactFrontmatter.js";
import { formatConfigParseError, formatParseError } from "../../src/schemas/formatError.js";
import {
  documentText,
  readDecoderInput,
  readTomlInput,
  streamLines,
  type Expected,
} from "./corpus.js";

// A decoded value as plain data: an Option as `{ _tag: "Some", value }` or
// `{ _tag: "None" }`, arrays and plain objects walked, a key whose value is
// undefined dropped. Anything else is returned as it is, for the canonical
// encoder to refuse.
function toPlain(value: unknown): unknown {
  if (Option.isOption(value)) {
    return Option.isSome(value) ? { _tag: "Some", value: toPlain(value.value) } : { _tag: "None" };
  }
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === "object" && value !== null) {
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toPlain(item)]),
    );
  }
  return value;
}

function accepted(value: unknown): Expected {
  return { ok: true, value: toPlain(value) };
}

function refused(refusal: string): Expected {
  return { ok: false, refusal };
}

function fromParse<A>(
  result: Either.Either<A, ParseResult.ParseError>,
  render: (error: ParseResult.ParseError) => string,
): Expected {
  return Either.isLeft(result) ? refused(render(result.left)) : accepted(result.right);
}

function fromLines<A>(result: Either.Either<A, string>): Expected {
  return Either.isLeft(result) ? refused(result.left) : accepted(result.right);
}

type Subject = (input: unknown) => Expected;

// A subject over several decoders: the input is `{ decoder, raw }`.
function byDecoder(decoders: Readonly<Record<string, (raw: unknown) => Expected>>): Subject {
  const table = new Map(Object.entries(decoders));
  return (input) => {
    const { decoder, raw } = readDecoderInput(input);
    const decode = table.get(decoder);
    if (decode === undefined) throw new Error(`corpus: no decoder ${JSON.stringify(decoder)}`);
    return decode(raw);
  };
}

// Each subject, with the phax call site it mirrors.
const SUBJECTS = new Map<string, Subject>([
  // src/app/loadConfig.ts loadConfig: decodePhaxConfig(raw), formatConfigParseError(raw, …).
  [
    "config/phax-config",
    (raw) => fromParse(decodePhaxConfig(raw), (e) => formatConfigParseError(raw, e)),
  ],
  // src/app/loadConfig.ts readUserOverlay: decodePhaxUserOverlay(raw), formatConfigParseError(raw, …).
  [
    "config/phax-user-overlay",
    (raw) => fromParse(decodePhaxUserOverlay(raw), (e) => formatConfigParseError(raw, e)),
  ],
  // src/app/loadRouting.ts readProviderConfigFile: decodeProviderConfig, formatParseError.
  ["config/provider-config", (raw) => fromParse(decodeProviderConfig(raw), formatParseError)],
  // src/app/loadRouting.ts loadModelRouting: decodeModelRouting, formatParseError.
  ["config/model-routing", (raw) => fromParse(decodeModelRouting(raw), formatParseError)],
  // src/app/loadTelemetryConfig.ts loadTelemetryConfig: decodeTelemetryConfig, formatParseError.
  ["config/telemetry-config", (raw) => fromParse(decodeTelemetryConfig(raw), formatParseError)],
  // src/app/vibeSetup.ts: extractBaseModel(toml, alias), its Left printed as it is.
  [
    "config/vibe-config",
    (input) => {
      const { toml, alias } = readTomlInput(input);
      return fromLines(extractBaseModel(toml, alias));
    },
  ],
  // src/domain/session/claudeOutcome.ts: scanClaudeOutcomeEvents(lines). Never refuses: a
  // line no decoder reads is skipped.
  ["answers/claude-output", (raw) => accepted(scanClaudeOutcomeEvents(streamLines(raw)))],
  // src/app/costLedger.ts: parseClaudeStream(lines). Never refuses: a line that does not
  // decode is skipped (a rate-limit event's is counted).
  ["answers/claude-stream", (raw) => accepted(parseClaudeStream(streamLines(raw)))],
  // src/domain/session/codexOutcome.ts: scanCodexOutcomeEvents(lines). Never refuses.
  ["answers/codex-output", (raw) => accepted(scanCodexOutcomeEvents(streamLines(raw)))],
  // src/domain/session/vibeOutcome.ts: findVibeResultEvent and findVibeStreamHead over the
  // stream's lines; undefined (no line decodes) reads as null. Never refuses.
  [
    "answers/vibe-output",
    byDecoder({
      findVibeResultEvent: (raw) => accepted(findVibeResultEvent(streamLines(raw)) ?? null),
      findVibeStreamHead: (raw) => accepted(findVibeStreamHead(streamLines(raw)) ?? null),
    }),
  ],
  // src/domain/records/usage.ts (decodeVibeExportText) and src/domain/session/vibeOutcome.ts
  // (decodeVibeOutcomeText, printed `(<reason>): <detail>` after the export's path).
  [
    "answers/vibe-export",
    byDecoder({
      decodeVibeExportText: (raw) => vibeExport(decodeVibeExportText(documentText(raw))),
      decodeVibeOutcomeText: (raw) => vibeExport(decodeVibeOutcomeText(documentText(raw))),
    }),
  ],
  // src/app/extractPlan.ts: readPlanExtractionAnswer(parsed), its Left printed as it is.
  ["answers/plan-extraction", (raw) => fromLines(readPlanExtractionAnswer(raw))],
  // src/app/authorArtifact.ts parseAuthoredDocument: the spec or plan authoring answer, its
  // Left (the first violation) printed as it is.
  [
    "answers/authoring-answer",
    byDecoder({
      spec: (raw) => fromLines(decodeAuthoredSpecDocument(raw)),
      plan: (raw) => fromLines(decodeAuthoredPlanDocument(raw)),
    }),
  ],
  // src/app/providerQuery.ts runProviderQuery (from planAuditor.ts): formatParseError.
  ["answers/plan-audit", (raw) => fromParse(decodePlanAuditResponse(raw), formatParseError)],
  // src/domain/artifact/frontmatter.ts decodeArtifactFrontmatter: the frontmatter's YAML
  // value through the spec or plan decoder, a refusal's detail formatParseError.
  [
    "documents/artifact-frontmatter",
    byDecoder({
      spec: (raw) => fromParse(decodeSpecFrontmatter(raw), formatParseError),
      plan: (raw) => fromParse(decodePlanFrontmatter(raw), formatParseError),
    }),
  ],
]);

function vibeExport<A>(
  result: Either.Either<A, { readonly reason: string; readonly detail: string }>,
): Expected {
  return Either.isLeft(result)
    ? refused(`(${result.left.reason}): ${result.left.detail}`)
    : accepted(result.right);
}

/** Decodes `input` as phax decodes the subject's input. Throws on an unknown subject. */
export function replay(subject: string, input: unknown): Expected {
  const decode = SUBJECTS.get(subject);
  if (decode === undefined) throw new Error(`corpus: unknown subject ${JSON.stringify(subject)}`);
  return decode(input);
}
