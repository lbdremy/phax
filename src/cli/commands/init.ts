import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { PromptCancelled } from "../../ports/prompt.js";
import { runInitWizard } from "../../app/initWizard.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";

export async function runInit(
  opts: { force?: boolean; yes?: boolean },
  out: OutputPort,
): Promise<number> {
  const interactive = Boolean(process.stdin.isTTY) && !opts.yes;

  const wizardInput: { cwd: string; force?: boolean; interactive: boolean } = {
    cwd: process.cwd(),
    interactive,
  };
  if (opts.force) wizardInput.force = opts.force;

  const effect = runInitWizard(wizardInput).pipe(
    Effect.provide(Layer.mergeAll(makeClackPromptLayer(), NodeFileSystemLayer)),
  );

  const result = await Effect.runPromise(Effect.either(effect));

  if (Either.isLeft(result)) {
    const err = result.left;
    if (err instanceof PromptCancelled) {
      out.log("phax init aborted — no changes written.");
      return 0;
    }
    out.error(err.message);
    return 1;
  }

  const outcome = result.right;

  if (outcome.kind === "already_initialized") {
    out.error(`PHAX is already initialized: ${outcome.configPath}`);
    out.error("Use --force to reconfigure.");
    return 1;
  }

  out.log(`Created PHAX config: ${outcome.configPath}`);
  out.log(`Created JSON Schema: ${outcome.schemaPath}`);
  out.log(`Schema: local generated schema (${outcome.schemaReference})`);
  if (!interactive) {
    out.log("Next: review phax.json, then run `phax validate` or `phax run`.");
  }
  return 0;
}
