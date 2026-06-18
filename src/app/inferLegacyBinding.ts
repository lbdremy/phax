import { Either } from "effect";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { providerToAdapter } from "../domain/providerAdapter.js";
import type { ProviderId } from "../domain/routing/types.js";
import { decodePhaseStatus } from "../schemas/status.js";
import type { PhaseAgentBinding } from "../schemas/phaseAgentBinding.js";
import { writeAgentBinding } from "./agentBinding.js";

const VALID_PROVIDER_IDS: ReadonlySet<string> = new Set([
  "claude-code",
  "codex-cli",
  "mistral-vibe",
]);

async function tryReadJson(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

export interface LegacyBindingContext {
  readonly shortName: string;
  readonly runId: string;
  readonly phaseName?: string;
}

export async function inferLegacyBinding(
  phaseFolderPath: string,
  context: LegacyBindingContext,
): Promise<Either.Either<PhaseAgentBinding, string>> {
  const resolutionRaw = await tryReadJson(join(phaseFolderPath, "model-resolution.json"));
  if (resolutionRaw === undefined || typeof resolutionRaw !== "object" || resolutionRaw === null) {
    return Either.left(
      "Cannot infer provider binding: model-resolution.json is absent or unreadable. " +
        "This phase was launched before PhaseAgentBinding was introduced.",
    );
  }

  const res = resolutionRaw as {
    selected?: {
      provider?: unknown;
      concreteModel?: unknown;
      thinking?: unknown;
    };
  };

  const rawProvider = res.selected?.provider;
  const rawConcreteModel = res.selected?.concreteModel;

  if (typeof rawProvider !== "string" || !VALID_PROVIDER_IDS.has(rawProvider)) {
    return Either.left(
      `Cannot infer provider binding: model-resolution.json has unrecognized provider "${String(rawProvider)}". ` +
        `Expected one of: ${[...VALID_PROVIDER_IDS].join(", ")}.`,
    );
  }

  if (typeof rawConcreteModel !== "string" || rawConcreteModel.length === 0) {
    return Either.left(
      "Cannot infer provider binding: model-resolution.json has no valid concreteModel.",
    );
  }

  const statusRaw = await tryReadJson(join(phaseFolderPath, "status.json"));
  const statusResult = decodePhaseStatus(statusRaw);
  if (Either.isLeft(statusResult)) {
    return Either.left(
      "Cannot infer provider binding: status.json is absent or invalid in this phase folder.",
    );
  }

  const phaseStatus = statusResult.right;

  if (!phaseStatus.worktreePath) {
    return Either.left(
      "Cannot infer provider binding: status.json has no worktreePath (phase may not have been set up yet).",
    );
  }

  if (!/^phase-\d{2}$/.test(phaseStatus.phaseId)) {
    return Either.left(
      `Cannot infer provider binding: phaseId "${phaseStatus.phaseId}" does not match expected pattern phase-NN.`,
    );
  }

  const provider = rawProvider as ProviderId;

  const rawThinking = res.selected?.thinking;
  const effort =
    typeof rawThinking === "string" && rawThinking.length > 0 ? rawThinking : phaseStatus.effort;

  const binding: PhaseAgentBinding = {
    version: 1,
    shortName: context.shortName,
    runId: context.runId,
    phaseId: phaseStatus.phaseId,
    phaseIndex: phaseStatus.phaseIndex,
    phaseName: context.phaseName ?? phaseStatus.phaseId,
    provider,
    adapter: providerToAdapter(provider),
    model: rawConcreteModel,
    effort,
    sessionId: phaseStatus.claudeSessionId ?? null,
    sessionHandle: null,
    worktreePath: phaseStatus.worktreePath,
    cwd: phaseStatus.worktreePath,
    launchedAt: phaseStatus.createdAt,
    lockSource: "legacy_inferred",
    status: "running",
  };

  try {
    await writeAgentBinding(phaseFolderPath, binding);
  } catch (err) {
    return Either.left(
      `Failed to persist inferred legacy binding: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return Either.right(binding);
}
