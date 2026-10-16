import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Effect, Either, Layer } from "effect";
import { type DecideArtifactResult, decideArtifact } from "../../app/decideArtifact.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { recordsClonePath } from "../../app/recordsSync.js";
import { decisionRecordPushWarning, decisionRecordWarning } from "../../app/writeDecisionRecord.js";
import { DECIDE_SKILL_FOR_KIND } from "../../domain/decide/doctrine.js";
import { AgentInvocationError } from "../../domain/errors.js";
import { makeNodeBackendLayer } from "../../infra/claudeCli.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { makeNodeGitLayer } from "../../infra/git.js";
import { NodeGitHubLayer } from "../../infra/github.js";
import { makeClackPromptLayer } from "../../infra/prompt.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import { NodeTerminalLayer } from "../../infra/terminal.js";
import type { Backend } from "../../ports/backend.js";
import { FileSystem } from "../../ports/fs.js";
import type { GitHub } from "../../ports/github.js";
import type { OutputPort } from "../../ports/output.js";
import type { Prompt } from "../../ports/prompt.js";
import type { Session } from "../../ports/session.js";
import type { Terminal } from "../../ports/terminal.js";
import { defaultBundleRoot } from "./skills.js";
import { exitCodeForAuthoringError, renderAgentInvocationError } from "./runLayers.js";

export interface DecideCommandOptions {
  readonly question?: string;
  readonly doctrine?: string;
  readonly model?: string;
  readonly effort?: string;
}

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface DecideCommandDeps {
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly sessionLayer?: Layer.Layer<Session>;
  readonly promptLayer?: Layer.Layer<Prompt>;
  readonly terminalLayer?: Layer.Layer<Terminal>;
  readonly githubLayer?: Layer.Layer<GitHub>;
}

// A path typed absolute or cwd-relative, as the repo-relative POSIX path the
// use case and the rooted FileSystem expect.
function toRepoRelativePath(pathArg: string, repoRoot: string): string {
  const absolute = isAbsolute(pathArg) ? pathArg : resolve(process.cwd(), pathArg);
  return relative(repoRoot, absolute).split(sep).join("/");
}

function renderResult(result: DecideArtifactResult, out: OutputPort): void {
  switch (result.kind) {
    case "nothing":
      out.log(`nothing to decide: ${result.path} has no open question`);
      return;
    case "undecided":
      out.log(`nothing decided: the session arbitrated no question — ${result.path} is unchanged`);
      return;
    case "declined":
      out.log(`body diff declined — nothing written`);
      return;
    case "committed":
      out.log(`commit     ${result.commit.hash.slice(0, 7)} — ${result.commit.subject}`);
      break;
  }
  const { record, recordPush } = result;
  if (record.kind === "written") out.log(`record     ${record.key}`);
  else if (record.kind === "records-off") out.log("record     off");
  else out.warn(decisionRecordWarning(record) ?? "decision record not written");
  const pushWarning = decisionRecordPushWarning(recordPush);
  if (pushWarning !== undefined) out.warn(pushWarning);
}

/**
 * `phax artifact decide <artifact>`: resolves phax.json, the state root and
 * the bundled doctrine skills, then calls `decideArtifact` once and renders
 * its result.
 */
export async function runArtifactDecide(
  pathArg: string,
  opts: DecideCommandOptions,
  out: OutputPort,
  deps: DecideCommandDeps = {},
): Promise<number> {
  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    out.error(`Config error: ${configResult.left.message}`);
    return 1;
  }
  const config = configResult.right;
  const repoRoot = config.repoRoot;
  const fsLayer = makeRootedNodeFileSystemLayer(repoRoot);

  const providerConfig = await Effect.runPromise(
    Effect.either(loadProviderConfig()).pipe(Effect.provide(fsLayer)),
  );
  if (Either.isLeft(providerConfig)) {
    out.error(`Failed to load routing config: ${providerConfig.left.message}`);
    return 1;
  }

  const layer = Layer.mergeAll(
    fsLayer,
    makeNodeGitLayer(),
    deps.backendLayer ?? makeNodeBackendLayer(providerConfig.right),
    deps.sessionLayer ?? makeNodeSessionLayer(),
    deps.promptLayer ?? makeClackPromptLayer(),
    deps.terminalLayer ?? NodeTerminalLayer,
    deps.githubLayer ?? NodeGitHubLayer,
  );

  const effect = Effect.gen(function* () {
    const fs = yield* FileSystem;
    const skillText = (name: string) => fs.readText(join(defaultBundleRoot(), name, "SKILL.md"));
    return yield* decideArtifact({
      path: toRepoRelativePath(pathArg, repoRoot),
      question: opts.question ?? null,
      doctrinePath:
        opts.doctrine === undefined ? null : toRepoRelativePath(opts.doctrine, repoRoot),
      model: opts.model,
      effort: opts.effort,
      bundledSkills: {
        spec: yield* skillText(DECIDE_SKILL_FOR_KIND.spec),
        plan: yield* skillText(DECIDE_SKILL_FOR_KIND.plan),
      },
      security: config.security,
      repoRoot,
      stateRoot: effectiveStateRoot(config),
      extractPlanModel: config.extractPlanModel,
      extractPlanEffort: config.extractPlanEffort,
      nowIso: new Date().toISOString(),
      records: config.records,
      publishRemote: config.publish.remote,
      ...(config.records.destination.kind === "repo"
        ? { recordsClonePath: recordsClonePath(config.stateRoot, config.namespace) }
        : {}),
      output: out,
    });
  }).pipe(Effect.provide(layer));

  const result = await Effect.runPromise(Effect.either(effect));
  if (Either.isLeft(result)) {
    const err = result.left;
    if (err instanceof AgentInvocationError) {
      // A handback that could not resume says why (Claude Code's stderr).
      const { message, logHint } = renderAgentInvocationError(err);
      out.error(`✗ ${message}`);
      if (logHint !== undefined) out.error(`  ${logHint}`);
    } else {
      out.error(`✗ ${err.message}`);
    }
    return exitCodeForAuthoringError(err);
  }
  renderResult(result.right, out);
  return 0;
}
