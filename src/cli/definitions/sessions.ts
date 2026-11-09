// `phax enter`, `enter-phase`, `shell` and `open` as the runner reads them: the commands that hand
// the terminal to an agent session, a shell or an editor. Each prompts, so `--json` refuses it with
// 64 before anything is read or started, naming the command that answers instead. Without `--json`
// each writes today's lines before it hands over: the `Target:` line of another project's run, then
// its announce, on stdout as they happen. The answer of a session is the process's own exit, which
// the runner exits after the (empty) render. A failure before the hand-over is a declared error
// with exit 1 (7 for a held run lock), its `Target:` line first on stdout as it was printed before
// the work began; a failure of the hand-over itself comes after the `Target:` line was said.
import { join } from "node:path";
import { Data, Effect, Result, Layer } from "effect";
import * as Schema from "effect/Schema";
import { readAgentBinding } from "../../app/agentBinding.js";
import { enterPhase } from "../../app/enterPhase.js";
import { loadConfig } from "../../app/loadConfig.js";
import { loadProviderConfig } from "../../app/loadRouting.js";
import { effectiveStateRoot } from "../../app/projectContext.js";
import { resolveRunRef } from "../../app/resolveRunRef.js";
import type { RunReviewInfo } from "../../app/resolveRunInfo.js";
import { runKey } from "../../domain/runRef.js";
import { getSessionAdapter } from "../../domain/session/index.js";
import { makeNodeEditorLayer } from "../../infra/editor.js";
import { makeRootedNodeFileSystemLayer } from "../../infra/fs.js";
import { NodeGitLayer } from "../../infra/git.js";
import { makeNodeLockLayer } from "../../infra/lock.js";
import { makeNodeSessionLayer } from "../../infra/session.js";
import type { Backend } from "../../ports/backend.js";
import { Editor } from "../../ports/editor.js";
import type { Git } from "../../ports/git.js";
import type { Lock } from "../../ports/lock.js";
import { Session } from "../../ports/session.js";
import { NoopSystemTelemetryLayer } from "../../ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../schemas/phaxConfig.js";
import { defineCommand, reject } from "../commandLibrary/contract/index.js";
import {
  exitCodeForError,
  makeProviderBackendLayer,
  makeRepoRootedFileSystemLayer,
} from "../commands/runLayers.js";
import { exposeMessage, ShortNameArg } from "./shared.js";

// ── What the commands that hand over the terminal share ─────────────────────────

/** The run reference was refused, or the call failed before a run was resolved. */
export class HandoverRefusedError extends Data.TaggedError("HandoverRefusedError")<{
  readonly message: string;
}> {}

/** The command failed after the run was resolved and before it said anything: its sentence. */
export class HandoverFailedError extends Data.TaggedError("HandoverFailedError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

/** The run lock is held by another process. */
export class HandoverLockError extends Data.TaggedError("HandoverLockError")<{
  readonly message: string;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}> {}

/** The session, shell or editor could not be started; the `Target:` line was already said. */
export class HandoverLaunchError extends Data.TaggedError("HandoverLaunchError")<{
  readonly message: string;
}> {}

const MessageOnly = Schema.Struct({ message: Schema.String });

const TargetedFields = Schema.Struct({
  message: Schema.String,
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
});

/** An error's text: its sentence, after the `Target:` line of another project's run. */
function targeted(
  error: { readonly qualifiedName: string; readonly crossProject: boolean },
  sentence: string,
) {
  return error.crossProject ? { out: `Target: ${error.qualifiedName}`, err: sentence } : sentence;
}

/** The exits, fields and sentences of the errors every one of these commands declares. */
export const handoverExits = {
  HandoverRefusedError: 1,
  HandoverFailedError: 1,
  HandoverLockError: 7,
  HandoverLaunchError: 1,
} as const;

export const handoverErrors = {
  HandoverRefusedError: MessageOnly,
  HandoverFailedError: TargetedFields,
  HandoverLockError: TargetedFields,
  HandoverLaunchError: MessageOnly,
} as const;

export const handoverTexts = {
  HandoverRefusedError: (error: HandoverRefusedError) => error.message,
  HandoverFailedError: (error: HandoverFailedError) => targeted(error, error.message),
  HandoverLockError: (error: HandoverLockError) => targeted(error, error.message),
  HandoverLaunchError: (error: HandoverLaunchError) => error.message,
} as const;

/** The process a handed-over session ran: what was started, where, and how it ended. */
export const HandedOver = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  executable: Schema.String,
  cwd: Schema.String,
  exit: Schema.Number,
});

/** A run reference resolved against the invocation directory's project, when it has one. */
export interface ResolvedTarget {
  readonly config: ResolvedConfig | undefined;
  readonly stateRoot: string;
  readonly namespace: string;
  readonly shortName: string;
  readonly info: RunReviewInfo;
  readonly qualifiedName: string;
  readonly crossProject: boolean;
}

/** The run `ref` names, in the project of the invocation directory or, with a qualified name,
 *  in another; or `HandoverRefusedError` with the resolver's sentence. */
export function resolveTarget(ref: string, config?: ResolvedConfig | undefined) {
  return Effect.suspend(() => {
    const loaded = config === undefined ? loadConfig(process.cwd()) : undefined;
    const project =
      loaded === undefined ? config : Result.isSuccess(loaded) ? loaded.right : undefined;
    const stateRoot = effectiveStateRoot(project);
    const resolved = resolveRunRef(ref, project, stateRoot);
    if (Result.isFailure(resolved)) {
      return Effect.fail(new HandoverRefusedError({ message: resolved.left.message }));
    }
    const { namespace, shortName, info, crossProject } = resolved.right;
    const target: ResolvedTarget = {
      config: project,
      stateRoot,
      namespace,
      shortName,
      info,
      qualifiedName: runKey(namespace, shortName),
      crossProject,
    };
    return Effect.succeed(target);
  });
}

/** The failure of a resolved run's command, before anything was said. */
export const failedFor = (target: ResolvedTarget, message: string) =>
  new HandoverFailedError({
    message,
    qualifiedName: target.qualifiedName,
    crossProject: target.crossProject,
  });

/** Hands the terminal to `invocation` through the Session port and answers its exit; a process
 *  that cannot start is `HandoverLaunchError`, `Failed to launch <label>: <message>`. */
export function handOver(
  layer: Layer.Layer<Session> | undefined,
  invocation: {
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  },
  label: string,
) {
  return Effect.gen(function* () {
    const session = yield* Session;
    return yield* session.resume(invocation);
  }).pipe(
    // The Node adapter is built when the session starts, not when the command is declared.
    Effect.provide(layer ?? makeNodeSessionLayer()),
    Effect.mapError(
      (error) =>
        new HandoverLaunchError({ message: `Failed to launch ${label}: ${error.message}` }),
    ),
  );
}

const sayTarget = (
  target: ResolvedTarget,
  say: (text: string) => Effect.Effect<void>,
): Effect.Effect<void> =>
  target.crossProject ? say(`Target: ${target.qualifiedName}`) : Effect.void;

// ── enter ───────────────────────────────────────────────────────────────────────

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface EnterDeps {
  readonly sessionLayer?: Layer.Layer<Session>;
}

const ENTER_HELP =
  "Attaches to the kept-open agent session in the final worktree, so you can review the agent's work, ask follow-up questions, or apply manual fixes interactively.";

export function makeEnterCommand(deps: EnterDeps = {}) {
  return defineCommand({
    name: "enter",
    summary: "Resume the final phase's agent session interactively",
    help: ENTER_HELP,
    examples: ["phax enter usage-cli"],
    input: { args: reject(Schema.Tuple([ShortNameArg])) },
    output: reject(HandedOver),
    // The session is a person's terminal.
    prompts: () => true,
    unprompted: "phax session-info <run> --json names the session",
    run: ({ input, say }) =>
      Effect.gen(function* () {
        const target = yield* resolveTarget(input.args[0]);
        const { info, qualifiedName, crossProject } = target;
        const binding = yield* Effect.promise(() =>
          readAgentBinding(join(info.runPath, info.finalPhaseId)),
        );
        if (Result.isFailure(binding)) {
          return yield* Effect.fail(
            failedFor(target, `No agent binding found for run "${qualifiedName}": ${binding.left}`),
          );
        }
        const invocation = getSessionAdapter(binding.right.provider).buildResumeInvocation(
          binding.right,
        );
        if ("unsupported" in invocation) {
          return yield* Effect.fail(failedFor(target, invocation.unsupported));
        }
        yield* sayTarget(target, say);
        yield* say(`Entering ${invocation.executable} session in ${invocation.cwd}`);
        const exit = yield* handOver(
          deps.sessionLayer,
          { ...invocation, env: {} },
          invocation.executable,
        );
        return {
          qualifiedName,
          crossProject,
          executable: invocation.executable,
          cwd: invocation.cwd,
          exit,
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: handoverExits,
    errors: handoverErrors,
    texts: handoverTexts,
    // Its lines are said as the session begins.
    render: () => "",
    // The session's exit is the command's.
    handsOver: (value) => value.exit,
  });
}

// ── enter-phase ─────────────────────────────────────────────────────────────────

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface EnterPhaseDeps {
  readonly sessionLayer?: Layer.Layer<Session>;
  readonly backendLayer?: Layer.Layer<Backend>;
  readonly lockLayer?: Layer.Layer<Lock>;
  readonly gitLayer?: Layer.Layer<Git>;
}

const ENTER_PHASE_HELP =
  "Continues a phase's agent session interactively in the phase's worktree: claude-code with `claude --resume` and codex with `codex resume`; mistral-vibe has no verified interactive resume. The session carries the phase's own filesystem, network and MCP posture, rebuilt from its security.json; a phase whose security.json cannot be read is refused rather than opened unconfined. Useful for inspecting intermediate state or debugging a phase that has not yet been committed to main.\n\nAt the stopped phase of a run in awaiting_review, it continues the stop's current session, or starts a fresh session with the stop's fresh-start command when no session is current or the provider's resume is unverified. --new-session first runs a new read-only first turn there under the run lock, makes its session current (keeping the earlier ones in interactive-session.json) and refreshes review-stop.json; a held lock refuses it with exit 7. A turn that fails or is refused leaves the previous session current. Once the run's close has started, enter-phase refuses the stopped phase until the close ends. At a held stop the current session is the builder's own, continued by default; --new-session starts a read-only look in a fresh session and refreshes only the session and the continue command of review-stop.json. --new-session on a phase that is not stopped is refused with exit 1.";

export function makeEnterPhaseCommand(deps: EnterPhaseDeps = {}) {
  return defineCommand({
    name: "enter-phase",
    summary: "Resume a specific phase's agent session interactively",
    help: ENTER_PHASE_HELP,
    examples: [
      "phax enter-phase usage-cli phase-02",
      "phax enter-phase usage-cli phase-03 --new-session",
    ],
    input: {
      args: reject(
        Schema.Tuple([
          ShortNameArg,
          Schema.String.annotate({
            identifier: "phase-id",
            description: "Phase identifier, e.g. phase-02",
          }),
        ]),
      ),
      flags: reject(
        Schema.Struct({
          newSession: Schema.optionalKey(
            Schema.Boolean.annotate({
              description:
                "At a stopped phase, run a new read-only first turn and continue its session",
            }),
          ),
        }),
      ),
    },
    output: reject(HandedOver),
    prompts: () => true,
    unprompted: "phax session-info <run> --json names the session",
    run: ({ input, say, progress }) =>
      Effect.gen(function* () {
        const phaseId = input.args[1];
        const target = yield* resolveTarget(input.args[0]);
        const { config, info, qualifiedName, crossProject, namespace, shortName, stateRoot } =
          target;
        if (!info.phaseStatuses.some((phase) => phase.phaseId === phaseId)) {
          return yield* Effect.fail(
            failedFor(target, `Phase "${phaseId}" not found in run "${qualifiedName}"`),
          );
        }
        // Every path the use case reads is absolute, so a run of another project needs no
        // project config: the file system is then rooted at the cwd.
        const fsLayer =
          config !== undefined
            ? makeRepoRootedFileSystemLayer(config)
            : makeRootedNodeFileSystemLayer(process.cwd());
        const providerConfig = yield* loadProviderConfig().pipe(
          Effect.provide(fsLayer),
          Effect.mapError((error) => failedFor(target, error.message)),
        );
        const planned = yield* enterPhase({
          namespace,
          shortName,
          info,
          phaseId,
          newSession: input.flags.newSession === true,
          stateRoot,
          providerConfig,
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              fsLayer,
              deps.gitLayer ?? NodeGitLayer,
              deps.backendLayer ?? makeProviderBackendLayer(providerConfig),
              deps.lockLayer ?? makeNodeLockLayer(stateRoot),
              NoopSystemTelemetryLayer,
            ),
          ),
          Effect.mapError((error) =>
            exitCodeForError(error) === 7
              ? new HandoverLockError({ message: error.message, qualifiedName, crossProject })
              : failedFor(target, error.message),
          ),
        );
        if (planned.kind === "refused") {
          return yield* Effect.fail(failedFor(target, planned.message));
        }
        const { command } = planned;
        yield* sayTarget(target, say);
        yield* say(planned.announce);
        for (const notice of planned.notices) {
          yield* notice.kind === "warning" ? progress(notice.text) : say(notice.text);
        }
        const exit = yield* handOver(
          deps.sessionLayer,
          {
            executable: command.executable,
            args: command.args,
            cwd: command.cwd,
            env: command.env,
          },
          command.executable,
        );
        return {
          qualifiedName,
          crossProject,
          executable: command.executable,
          cwd: command.cwd,
          exit,
        };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: handoverExits,
    errors: handoverErrors,
    texts: handoverTexts,
    render: () => "",
    handsOver: (value) => value.exit,
  });
}

// ── shell ───────────────────────────────────────────────────────────────────────

const SHELL_HELP =
  "Opens an interactive shell in the final worktree. Useful for manually inspecting files, running tests, or executing commands outside the agent session. For a run in awaiting_review it opens the stopped phase's worktree.";

export function makeShellCommand(deps: EnterDeps = {}) {
  return defineCommand({
    name: "shell",
    summary: "Open a shell in the final worktree",
    help: SHELL_HELP,
    examples: ["phax shell usage-cli"],
    input: { args: reject(Schema.Tuple([ShortNameArg])) },
    output: reject(HandedOver),
    prompts: () => true,
    unprompted: "phax path <run> --json names the worktree",
    run: ({ input, say }) =>
      Effect.gen(function* () {
        const target = yield* resolveTarget(input.args[0]);
        const { info, qualifiedName, crossProject } = target;
        if (!info.worktreePath) {
          return yield* Effect.fail(
            failedFor(target, `No worktree path found for run "${qualifiedName}".`),
          );
        }
        const executable = process.env["SHELL"] ?? "bash";
        yield* sayTarget(target, say);
        yield* say(`Opening shell in ${info.worktreePath}`);
        const exit = yield* handOver(
          deps.sessionLayer,
          { executable, args: [], cwd: info.worktreePath, env: {} },
          "shell",
        );
        return { qualifiedName, crossProject, executable, cwd: info.worktreePath, exit };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: handoverExits,
    errors: handoverErrors,
    texts: handoverTexts,
    render: () => "",
    handsOver: (value) => value.exit,
  });
}

// ── open ────────────────────────────────────────────────────────────────────────

/** Layers a test swaps for fakes; each defaults to the real adapter. */
export interface OpenDeps {
  readonly editorLayer?: Layer.Layer<Editor>;
}

const OpenOutput = Schema.Struct({
  qualifiedName: Schema.String,
  crossProject: Schema.Boolean,
  opened: Schema.String,
});

const OPEN_HELP =
  "Opens the final worktree in the editor configured in phax.json (or the EDITOR environment variable). Equivalent to running your editor with the worktree path as an argument. For a run in awaiting_review it opens the stopped phase's worktree.";

export function makeOpenCommand(deps: OpenDeps = {}) {
  return defineCommand({
    name: "open",
    summary: "Open the final worktree in the configured editor",
    help: OPEN_HELP,
    examples: ["phax open usage-cli"],
    input: { args: reject(Schema.Tuple([ShortNameArg])) },
    output: reject(OpenOutput),
    // The configured editor may be a terminal one.
    prompts: () => true,
    unprompted: "phax path <run> --json names the worktree",
    run: ({ input }) =>
      Effect.gen(function* () {
        const target = yield* resolveTarget(input.args[0]);
        const { info, qualifiedName, crossProject } = target;
        if (!info.worktreePath) {
          return yield* Effect.fail(
            failedFor(target, `No worktree path found for run "${qualifiedName}".`),
          );
        }
        const path = info.worktreePath;
        yield* Effect.gen(function* () {
          const editor = yield* Editor;
          yield* editor.open(path);
        }).pipe(
          Effect.provide(deps.editorLayer ?? makeNodeEditorLayer()),
          Effect.mapError((error) =>
            failedFor(target, `Failed to open worktree: ${error.message}`),
          ),
        );
        return { qualifiedName, crossProject, opened: path };
      }).pipe(Effect.mapError(exposeMessage)),
    exits: handoverExits,
    errors: handoverErrors,
    texts: handoverTexts,
    render: (value) =>
      [
        ...(value.crossProject ? [`Target: ${value.qualifiedName}`] : []),
        `Opened ${value.opened}`,
      ].join("\n"),
  });
}

/** The commands as the program declares them: real adapters. */
export const enterCommand = makeEnterCommand();
export const enterPhaseCommand = makeEnterPhaseCommand();
export const shellCommand = makeShellCommand();
export const openCommand = makeOpenCommand();
