import { Effect, Either } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { pullArchitecture } from "../../app/architectureProvider.js";
import { loadConfig, locateWorkingTree } from "../../app/loadConfig.js";
import {
  renderArchitectureReport,
  renderAssignmentBounds,
} from "../../domain/architecture/render.js";
import { NO_ARCHITECTURE_PROVIDER } from "../../domain/architecture/request.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { reportConfigError } from "./reportConfigError.js";

/**
 * `phax architecture [path…]`. Config comes from the repository's main
 * checkout, so a provider declared in its gitignored phax.local.json serves a
 * call from a phase worktree too; the provider runs from the cwd's own working
 * tree. Nothing is written.
 */
export async function runArchitecture(
  paths: readonly string[],
  out: OutputPort,
  cwd: string = process.cwd(),
): Promise<number> {
  const tree = locateWorkingTree(cwd);
  if (tree === undefined) {
    out.error(`✗ phax architecture: ${cwd} is not inside a git working tree`);
    return 1;
  }
  const configResult = loadConfig(tree.mainRoot);
  if (Either.isLeft(configResult)) {
    reportConfigError(configResult.left, out);
    return 2;
  }
  const { architecture, assignments } = configResult.right;
  if (architecture === undefined) {
    out.log(NO_ARCHITECTURE_PROVIDER);
    if (assignments !== undefined) {
      out.log("");
      out.log(renderAssignmentBounds(assignments, { kind: "no-provider" }));
    }
    return 1;
  }

  const result = await Effect.runPromise(
    pullArchitecture({ command: architecture.command, root: tree.root, cwd, paths }).pipe(
      Effect.provide(NodeShellLayer),
    ),
  );
  if (result.kind === "refused") {
    out.error(`✗ phax architecture: ${result.message}`);
    return 1;
  }
  if (result.kind === "failed") {
    out.error(`✗ ${result.reason}`);
    return 1;
  }
  out.log(renderArchitectureReport(result.report));
  if (assignments !== undefined) {
    out.log("");
    out.log(
      renderAssignmentBounds(assignments, {
        kind: "report",
        report: result.report,
        scoped: paths.length > 0,
      }),
    );
  }
  return 0;
}
