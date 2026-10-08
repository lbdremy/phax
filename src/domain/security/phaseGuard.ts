/**
 * The phase guard: inside a phase worktree, phax refuses every command that
 * acts on phax state or an artifact's lifecycle, before the command runs. It
 * guards against an agent running such a command by mistake on a provider
 * without command enforcement; it is not a boundary — the sandbox's write
 * scope is.
 */

export type PhaseGuardClass = "allowed" | "refused";

/**
 * Every subcommand path registered in src/cli/program.ts. Allowed are
 * `phax brief`, `schema upgrade` (it writes only the working tree's local
 * schemas) and the commands that only read. A unit test fails on a registered
 * command missing here, so a new command is refused until it is classified.
 */
export const PHASE_GUARD_CLASSIFICATION: Readonly<Record<string, PhaseGuardClass>> = {
  brief: "allowed",
  "schema upgrade": "allowed",
  validate: "allowed",
  ls: "allowed",
  path: "allowed",
  "session-info": "allowed",
  completions: "allowed",
  "plans lint": "allowed",
  "plans status": "allowed",
  "artifact status": "allowed",
  "artifact schema": "allowed",
  "records explain": "allowed",
  "records status": "allowed",
  "records list": "allowed",
  "security status": "allowed",

  unlock: "refused",
  enter: "refused",
  "enter-phase": "refused",
  shell: "refused",
  open: "refused",
  archive: "refused",
  prune: "refused",
  run: "refused",
  resume: "refused",
  "reset-phase": "refused",
  "review-handoff": "refused",
  "publish-pr": "refused",
  "review-compliance": "refused",
  "review-code": "refused",
  "adjust-plan": "refused",
  init: "refused",
  report: "refused",
  "agent models": "refused",
  "agent resolve": "refused",
  "agent probe": "refused",
  "agent setup mistral-vibe": "refused",
  "agent setup providers": "refused",
  "skills install": "refused",
  "artifact approve": "refused",
  "artifact stale": "refused",
  "artifact abandon": "refused",
  "artifact complete": "refused",
  "artifact reopen": "refused",
  "artifact new spec": "refused",
  "artifact new plan": "refused",
  "artifact migrate-approvals": "refused",
  "artifact archive": "refused",
  "plans overlap": "refused",
  "records init": "refused",
  "records sync": "refused",
};

/**
 * Options that turn an allowed command into one acting on an artifact's
 * lifecycle: `plans status --apply` flips stale plans and commits the flip.
 */
const REFUSED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "plans status": ["apply"],
};

/**
 * A phase worktree is recognised from the cwd alone: a linked git worktree
 * whose root holds `.phax-context/`. No environment variable — the agent's
 * test processes would inherit it — and no escape hatch.
 */
export function isPhaseWorktree(tree: {
  readonly isLinkedWorktree: boolean;
  readonly hasPhaxContext: boolean;
}): boolean {
  return tree.isLinkedWorktree && tree.hasPhaxContext;
}

/**
 * The refusal to print for `commandPath` run inside a phase worktree, or
 * undefined when it may run. An unclassified command is refused.
 */
export function phaseGuardRefusal(
  commandPath: string,
  options: Readonly<Record<string, unknown>> = {},
): string | undefined {
  const allowed =
    PHASE_GUARD_CLASSIFICATION[commandPath] === "allowed" &&
    !(REFUSED_OPTIONS[commandPath] ?? []).some(
      (o) => options[o] !== undefined && options[o] !== false,
    );
  return allowed
    ? undefined
    : `✗ phax ${commandPath} is not available inside a phase worktree; phax brief is`;
}
