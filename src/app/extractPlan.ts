import { Effect, Either, Schema } from "effect";
import { dirname, join } from "node:path";
import { Backend } from "../ports/backend.js";
import { FileSystem, type FsError } from "../ports/fs.js";
import { Lock } from "../ports/lock.js";
import { Tracer } from "../ports/tracer.js";
import { PhaxPlanSchema, getPhaxPlanJsonSchema, type PhaxPlan } from "../schemas/phaxPlan.js";
import { ClaudeInvocationError, LockConflictError, PlanValidationError } from "../domain/errors.js";
import { decodeShortName } from "../domain/branded.js";
import { formatParseError } from "../schemas/formatError.js";

const decodePlan = Schema.decodeUnknownEither(PhaxPlanSchema, { onExcessProperty: "error" });

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

export interface ExtractPlanOptions {
  readonly planMdPath: string;
  readonly outPath: string;
  readonly force: boolean;
  readonly model: string;
  readonly effort: string;
  readonly cwd: string;
}

export interface ExtractPlanResult {
  readonly plan: PhaxPlan;
  readonly outPath: string;
  readonly reportPath: string;
  readonly warnings: string[];
}

export type ExtractPlanError =
  | PlanValidationError
  | ClaudeInvocationError
  | FsError
  | LockConflictError;

export function extractPlan(
  opts: ExtractPlanOptions,
): Effect.Effect<ExtractPlanResult, ExtractPlanError, Backend | FileSystem | Lock | Tracer> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem;
    const backend = yield* Backend;
    const lock = yield* Lock;
    const tracer = yield* Tracer;

    const emitContract = (
      event: "contract.validated" | "contract.invalid",
      status: "ok" | "failed",
      details?: Record<string, unknown>,
    ): Effect.Effect<void, never, never> =>
      tracer.event({
        timestamp: new Date().toISOString(),
        run: "extract-plan",
        event,
        boundary: "phax-plan.json",
        status,
        details,
      });

    const planMd = yield* fs.readText(opts.planMdPath).pipe(
      Effect.mapError(
        (e) =>
          new PlanValidationError({
            message: `Failed to read plan.md at "${opts.planMdPath}": ${e.message}`,
            path: opts.planMdPath,
          }),
      ),
    );

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

    const jsonSchema = getPhaxPlanJsonSchema();
    const prompt = buildExtractionPrompt(planMd, jsonSchema);

    const runResult = yield* backend.runAgent(prompt, {
      model: opts.model,
      effort: opts.effort,
      cwd: opts.cwd,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(runResult.finalText);
    } catch {
      yield* emitContract("contract.invalid", "failed", { reason: "non-json-output" });
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Claude returned non-JSON output. Raw response: ${runResult.finalText.slice(0, 300)}`,
        }),
      );
    }

    // Local schema validation is mandatory regardless of which model produced the output (spec §6).
    const decoded = decodePlan(parsed);
    if (Either.isLeft(decoded)) {
      yield* emitContract("contract.invalid", "failed", { reason: "schema-validation-failed" });
      return yield* Effect.fail(
        new PlanValidationError({
          message: `Extracted JSON failed schema validation:\n${formatParseError(decoded.left)}`,
        }),
      );
    }
    yield* emitContract("contract.validated", "ok", { phases: decoded.right.phases.length });
    const plan = decoded.right;

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

    yield* fs.writeAtomic(opts.outPath, JSON.stringify(plan, null, 2));

    const reportPath = join(dirname(opts.outPath), "extract-report.md");
    yield* fs.writeAtomic(reportPath, buildExtractReport(plan, detectedAnchors, warnings));

    return { plan, outPath: opts.outPath, reportPath, warnings };
  });
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
