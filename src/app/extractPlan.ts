import { Array as Arr, Effect, Either, Schema } from "effect";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Lock } from "../ports/lock.js";
import {
  ExtractedPhaxPlanSchema,
  getExtractedPlanJsonSchema,
  type PhaxPlan,
} from "../schemas/phaxPlan.js";
import {
  AgentInvocationError,
  LockConflictError,
  PlanValidationError,
  RateLimitError,
  UsageLimitError,
} from "../domain/errors.js";
import { decodeShortName, slugifyShortName } from "../domain/branded.js";
import { formatParseError } from "../schemas/formatError.js";

const decodeExtractedPlan = Schema.decodeUnknownEither(ExtractedPhaxPlanSchema, {
  onExcessProperty: "error",
});

// Derive each phase title from its plan.md heading rather than asking the model
// to round-trip it through JSON. A `"` in a title would otherwise derail the
// extraction model into malformed output. Matches `## phase-NN — <title> {#...}`
// (em/en-dash or hyphen). JSON.stringify on write escapes any quotes safely, so
// titles keep their original text.
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

function buildExtractionPrompt(planMd: string, jsonSchema: object): string {
  return [
    "You are extracting structured phase data from a phax plan markdown document.",
    "",
    "Read the plan document below and return ONLY a valid JSON object that conforms to the provided JSON Schema.",
    "Rules:",
    "- Return raw JSON only. No markdown, no code fences, no explanation.",
    "- Do not invent phases that are not explicitly described in the document.",
    "- Do not guess missing required fields — if a field is missing, that is an error.",
    "- Extract ONLY what is explicitly stated.",
    "",
    "JSON Schema:",
    JSON.stringify(jsonSchema, null, 2),
    "",
    "Plan document:",
    planMd,
  ].join("\n");
}

function buildExtractReport(plan: PhaxPlan, detectedAnchors: string[], warnings: string[]): string {
  const lines: string[] = [
    "# Extract Report",
    "",
    `**Generated:** ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `- Anchors detected in plan.md: ${detectedAnchors.length}${detectedAnchors.length ? ` (${detectedAnchors.join(", ")})` : ""}`,
    `- Phases extracted: ${plan.phases.length}`,
    `- Run short name: ${plan.run.shortName}`,
    `- Required commands: ${plan.run.requiredCommands.length}${plan.run.requiredCommands.length ? ` (${plan.run.requiredCommands.join(", ")})` : ""}`,
    `- Schema validation: passed`,
    "",
  ];

  if (warnings.length > 0) {
    lines.push("## Warnings", "");
    for (const w of warnings) {
      lines.push(`- ${w}`);
    }
    lines.push("");
  }

  lines.push("## Extracted Phases", "");
  for (const phase of plan.phases) {
    lines.push(`### ${phase.id}: ${phase.title}`, "");
    lines.push(`- model: ${phase.model}`);
    lines.push(`- effort: ${phase.effort}`);
    lines.push(`- anchor: ${phase.planMarkdownAnchor}`);
    lines.push(`- commit.subject: ${phase.commit.subject}`);
    lines.push("");
  }

  return lines.join("\n");
}

export interface ExtractPlanCoreOptions {
  readonly planMdPath: string;
  readonly model: string;
  readonly effort: string;
}

export interface ExtractPlanCoreResult {
  readonly plan: PhaxPlan;
  readonly planMd: string;
  readonly warnings: string[];
  readonly detectedAnchors: string[];
}

export type ExtractPlanCoreError =
  | PlanValidationError
  | AgentInvocationError
  | RateLimitError
  | UsageLimitError
  | FsError;

/**
 * Extract a PhaxPlan from a plan.md file via Claude. Performs no file writes —
 * callers persist the result wherever they want (cwd for `phax extract-plan`,
 * the run folder for `phax run`).
 */
export function extractPlanCore(
  opts: ExtractPlanCoreOptions,
): Effect.Effect<ExtractPlanCoreResult, ExtractPlanCoreError, Backend | FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const backend = yield* Backend;

    const planMd = yield* fs.readText(opts.planMdPath).pipe(
      Effect.mapError(
        (e) =>
          new PlanValidationError({
            message: `Failed to read plan.md at "${opts.planMdPath}": ${e.message}`,
            path: opts.planMdPath,
          }),
      ),
    );

    const jsonSchema = getExtractedPlanJsonSchema();
    const prompt = buildExtractionPrompt(planMd, jsonSchema);

    const tempDir = join(tmpdir(), "phax-extract-" + randomUUID());
    const runResult = yield* Effect.acquireUseRelease(
      fs.mkdirp(tempDir).pipe(Effect.as(tempDir)),
      (dir) =>
        backend.complete(prompt, {
          provider: "claude-code",
          model: opts.model,
          effort: opts.effort,
          cwd: dir,
        }),
      (dir) => fs.remove(dir).pipe(Effect.orElse(() => Effect.void)),
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonCodeFence(runResult.finalText));
    } catch {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Claude returned non-JSON output. Raw response: ${runResult.finalText.slice(0, 300)}`,
        }),
      );
    }

    // Local schema validation is mandatory regardless of which model produced the output (spec §6).
    const decoded = decodeExtractedPlan(parsed);
    if (Either.isLeft(decoded)) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Extracted JSON failed schema validation:\n${formatParseError(decoded.left)}`,
        }),
      );
    }

    // Titles are derived from headings, not extracted from the model. Fail
    // loudly if a phase has no matching `## <phase-id> — <title> {#anchor}`
    // heading rather than persisting a phase with an empty title.
    const phaseTitles = parsePhaseTitles(planMd);
    const missingTitle = decoded.right.phases.filter((p) => {
      const t = phaseTitles.get(p.id);
      return t === undefined || t.length === 0;
    });
    if (missingTitle.length > 0) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Could not derive a title from plan.md for: ${missingTitle.map((p) => p.id).join(", ")}. Each phase needs a "## <phase-id> — <title> {#anchor}" heading.`,
        }),
      );
    }
    const phasesWithTitles = Arr.map(decoded.right.phases, (p) => ({
      ...p,
      title: phaseTitles.get(p.id) as string,
    }));

    // The model is asked for a shortName but routinely returns prose (often the
    // plan title), which fails the strict ShortName brand downstream. Slugify it
    // ourselves rather than trust the model, falling back to the title.
    const shortName =
      slugifyShortName(decoded.right.run.shortName) ||
      slugifyShortName(decoded.right.run.title) ||
      "run";
    const plan: PhaxPlan = {
      version: decoded.right.version,
      run: {
        ...decoded.right.run,
        shortName,
        branch: `phax/${shortName}`,
        requiredCommands: decoded.right.run.requiredCommands,
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

    return { plan, planMd, warnings, detectedAnchors };
  });
}

export interface ExtractPlanOptions extends ExtractPlanCoreOptions {
  readonly outPath: string;
  readonly force: boolean;
}

export interface ExtractPlanResult {
  readonly plan: PhaxPlan;
  readonly outPath: string;
  readonly reportPath: string;
  readonly warnings: string[];
}

export type ExtractPlanError = ExtractPlanCoreError | LockConflictError;

/**
 * Persistent wrapper around `extractPlanCore`: validates the target path is
 * writable (no clobbering an active run), runs the core extraction, then writes
 * `phax-plan.json` and `extract-report.md` next to it.
 */
export function extractPlan(
  opts: ExtractPlanOptions,
): Effect.Effect<ExtractPlanResult, ExtractPlanError, Backend | FileSystem | Lock> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const lock = yield* Lock;

    const outExists = yield* fs.exists(opts.outPath);

    if (outExists && !opts.force) {
      return yield* Effect.fail(
        new PlanValidationError({
          message: `"${opts.outPath}" already exists. Use --force to overwrite.`,
          path: opts.outPath,
        }),
      );
    }

    // When forcing over an existing file, guard against overwriting a plan that belongs to an active run.
    if (outExists && opts.force) {
      const existingText = yield* fs.readText(opts.outPath).pipe(Effect.orElseSucceed(() => "{}"));
      const existingShortName = parseShortNameFromPlanText(existingText);
      if (existingShortName !== undefined) {
        const shortNameResult = decodeShortName(existingShortName);
        if (Either.isRight(shortNameResult)) {
          const lockStatus = yield* lock
            .status(shortNameResult.right)
            .pipe(Effect.orElseSucceed(() => ({ kind: "none" as const })));
          if (lockStatus.kind === "active") {
            return yield* Effect.fail(
              new LockConflictError({
                message: `Run "${existingShortName}" has an active lock (pid ${lockStatus.pid}). Stop the run before overwriting its plan.`,
                shortName: existingShortName,
                lockPath: "",
                lockingPid: lockStatus.pid,
              }),
            );
          }
        }
      }
    }

    const { plan, warnings, detectedAnchors } = yield* extractPlanCore(opts);

    yield* fs.writeAtomic(opts.outPath, JSON.stringify(plan, null, 2));

    const reportPath = join(dirname(opts.outPath), "extract-report.md");
    yield* fs.writeAtomic(reportPath, buildExtractReport(plan, detectedAnchors, warnings));

    return { plan, outPath: opts.outPath, reportPath, warnings };
  });
}

// Claude sometimes wraps JSON output in a ```json fence despite the prompt
// forbidding it. Strip a single leading/trailing fence so JSON.parse succeeds.
function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fence);
  return match?.[1]?.trim() ?? trimmed;
}

function parseShortNameFromPlanText(text: string): string | undefined {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (typeof parsed === "object" && parsed !== null) {
      const run = (parsed as Record<string, unknown>)["run"];
      if (typeof run === "object" && run !== null) {
        const shortName = (run as Record<string, unknown>)["shortName"];
        if (typeof shortName === "string" && shortName.length > 0) return shortName;
      }
    }
  } catch {
    // ignore
  }
  return undefined;
}
