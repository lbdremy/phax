import { Effect, Either, Layer } from "effect";
import type { OutputPort } from "../../ports/output.js";
import { loadConfig } from "../../app/loadConfig.js";
import { expandOrientRow, queryOrientIndex } from "../../app/orient.js";
import { NodeFileSystemLayer } from "../../infra/fs.js";
import { NodeShellLayer } from "../../infra/shell.js";
import { makeGlobalTelemetryJournalLayer } from "../../infra/telemetry/globalJournal.js";
import { NoopSystemTelemetryLayer, SystemTelemetry } from "../../ports/systemTelemetry.js";
import { Shell } from "../../ports/shell.js";
import {
  loadTelemetryConfig,
  TELEMETRY_CONFIG_PATH,
  PHAX_HOME_DIR,
} from "../../app/loadTelemetryConfig.js";
import {
  makeOrientPullEmptyTelemetryEvent,
  makeOrientPullServedTelemetryEvent,
} from "../../domain/telemetry/events.js";
import type { RunId } from "../../domain/branded.js";
import type { OrientRow } from "../../schemas/orient.js";
import { reportConfigError } from "./reportConfigError.js";

export interface OrientCommandOptions {
  readonly file?: string;
}

// `phax orient` is invoked by the in-phase agent from inside a phase worktree,
// which has no resolvable RunId (no marker file/env var ties the worktree back
// to its run — see src/app/worktree.ts). A stable placeholder mirrors the one
// already used by `extract-plan` for the same "no run context yet" situation.
const ORIENT_TELEMETRY_RUN_ID = "orient" as unknown as RunId;

function buildLayer(): Layer.Layer<Shell | SystemTelemetry> {
  const telemetryConfig = loadTelemetryConfig(TELEMETRY_CONFIG_PATH);
  const telemetryEnabled = Either.isRight(telemetryConfig) ? telemetryConfig.right.enabled : true;
  const telemetryLayer = telemetryEnabled
    ? makeGlobalTelemetryJournalLayer(PHAX_HOME_DIR).pipe(Layer.provide(NodeFileSystemLayer))
    : NoopSystemTelemetryLayer;
  return Layer.mergeAll(NodeShellLayer, telemetryLayer);
}

function formatIndexRow(row: OrientRow): string {
  return `[${row.severity}] ${row.id} — ${row.title}`;
}

type OrientOutcome =
  | { readonly kind: "row"; readonly body: string }
  | { readonly kind: "index"; readonly rows: readonly OrientRow[] }
  | { readonly kind: "empty" }
  | { readonly kind: "provider-error"; readonly message: string };

export async function runOrient(
  idArg: string | undefined,
  opts: OrientCommandOptions,
  out: OutputPort,
): Promise<number> {
  const hasId = idArg !== undefined && idArg !== "";
  const hasFile = opts.file !== undefined;

  if (hasId === hasFile) {
    out.error("Provide exactly one of: <id> or --file <path>.");
    return 2;
  }

  const configResult = loadConfig(process.cwd());
  if (Either.isLeft(configResult)) {
    reportConfigError(configResult.left, out);
    return 1;
  }
  const config = configResult.right;

  if (config.orient === undefined) {
    out.error(
      "No orient provider is configured. Add an `orient: { command }` block to phax.json to enable `phax orient`.",
    );
    return 1;
  }
  const orientConfig = config.orient;
  const cwd = process.cwd();

  const effect = Effect.gen(function* () {
    const telemetry = yield* SystemTelemetry;

    if (hasId) {
      const id = idArg as string;
      const queried = yield* expandOrientRow(orientConfig, id, cwd);
      if (Either.isLeft(queried)) {
        return { kind: "provider-error", message: queried.left.message } as const;
      }
      const row = queried.right.row;
      if (row === null) {
        yield* telemetry.recordEvent(
          makeOrientPullEmptyTelemetryEvent({
            runId: ORIENT_TELEMETRY_RUN_ID,
            kind: "expand",
            subject: id,
          }),
        );
        return { kind: "empty" } as const;
      }
      yield* telemetry.recordEvent(
        makeOrientPullServedTelemetryEvent({
          runId: ORIENT_TELEMETRY_RUN_ID,
          kind: "expand",
          subject: id,
        }),
      );
      return { kind: "row", body: row.body } as const;
    }

    const file = opts.file as string;
    const queried = yield* queryOrientIndex(orientConfig, [file], cwd);
    if (Either.isLeft(queried)) {
      return { kind: "provider-error", message: queried.left.message } as const;
    }
    const rows = queried.right.rows;
    if (rows.length === 0) {
      yield* telemetry.recordEvent(
        makeOrientPullEmptyTelemetryEvent({
          runId: ORIENT_TELEMETRY_RUN_ID,
          kind: "file",
          subject: file,
        }),
      );
      return { kind: "empty" } as const;
    }
    yield* telemetry.recordEvent(
      makeOrientPullServedTelemetryEvent({
        runId: ORIENT_TELEMETRY_RUN_ID,
        kind: "file",
        subject: file,
      }),
    );
    return { kind: "index", rows } as const;
  }).pipe(Effect.provide(buildLayer()));

  const outcome: OrientOutcome = await Effect.runPromise(effect);

  switch (outcome.kind) {
    case "provider-error":
      out.error(`Orient provider error: ${outcome.message}`);
      return 1;
    case "empty":
      // The channel is strictly advisory: exit 0 so an empty pull never reads
      // as a command failure to the agent (spec §5.4).
      out.log("No orientation available.");
      return 0;
    case "row":
      out.log(outcome.body);
      return 0;
    case "index":
      for (const row of outcome.rows) {
        out.log(formatIndexRow(row));
      }
      return 0;
  }
}
