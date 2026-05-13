import { Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { decodeShortName } from "../../domain/branded.js";
import { loadConfig } from "../../app/loadConfig.js";
import { inspectResume } from "../../app/resume.js";

export interface ResumeCommandOptions {
  yes?: boolean;
}

export async function runResume(
  shortNameArg: string,
  opts: ResumeCommandOptions,
  out: OutputPort,
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const { stateRoot } = configResult.right;

  const shortNameResult = decodeShortName(shortNameArg);
  if (Either.isLeft(shortNameResult)) {
    out.error(`Invalid short name "${shortNameArg}": must match ^[a-z][a-z0-9-]*$ (1–64 chars)`);
    return 1;
  }
  const shortName = shortNameResult.right;

  const decisionResult = inspectResume(shortName, stateRoot);
  if (Either.isLeft(decisionResult)) {
    const refusal = decisionResult.left;
    if (refusal.reason === "review_open") {
      out.warn(refusal.message);
      return 0;
    }
    out.error(refusal.message);
    return 1;
  }

  const decision = decisionResult.right;
  out.log(
    `Run "${decision.shortName}" (state: ${decision.fromState}) — would resume from phase ${decision.nextPhaseIndex + 1}: ${decision.nextPhaseId}`,
  );

  if (!opts.yes) {
    out.log("Pass --yes to proceed.");
    return 0;
  }

  out.error(
    "phax resume execution is not yet implemented. Use phax enter to continue interactively.",
  );
  return 1;
}
