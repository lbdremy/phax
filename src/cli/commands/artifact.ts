// `phax artifact` answers through the command runner, which holds the whole group
// (src/cli/definitions/artifact.ts). What stays here are the run functions kept, until the last
// plan of command-contracts, for the tests that call them: each a definition's run and render
// over the OutputPort.
import type { OutputPort } from "../../ports/output.js";
import type { CompletionFlags } from "../../app/createArtifact.js";
import type { ArtifactKind, ArtifactStatus } from "../../domain/artifact/status.js";
import {
  renderDocumentMigrationReport,
  renderMigrationReport,
} from "../../domain/artifact/render.js";
import { runThroughOutput } from "../bridge.js";
import type { Command as RunnerCommand } from "../commandLibrary/contract/index.js";
import {
  artifactMigrateApprovalsCommand,
  artifactMigrateDocumentsCommand,
} from "../definitions/artifactMigrations.js";
import {
  makeArtifactNewPlanCommand,
  makeArtifactNewSpecCommand,
} from "../definitions/artifactNew.js";
import { artifactSchemaCommand } from "../definitions/artifactSchema.js";
import {
  artifactAbandonCommand,
  artifactApproveCommand,
  artifactCompleteCommand,
  artifactReopenCommand,
  artifactStaleCommand,
  transitionLines,
} from "../definitions/artifactTransitions.js";

export interface TransitionFlags {
  /** `--by`, raw: the use case parses and resolves it. */
  readonly by?: string;
}

const TRANSITION_COMMANDS: Readonly<Record<ArtifactStatus, RunnerCommand<never>>> = {
  Approved: artifactApproveCommand,
  Stale: artifactStaleCommand,
  Abandoned: artifactAbandonCommand,
  Completed: artifactCompleteCommand,
  Draft: artifactReopenCommand,
};

/** The transitions answer through the command runner (src/cli/definitions/artifactTransitions.ts);
 *  this is kept, until the last plan of command-contracts, as the definition's run and render
 *  over the OutputPort, for the tests that call it. */
export function runArtifactTransition(
  pathArg: string,
  target: ArtifactStatus,
  out: OutputPort,
  flags: TransitionFlags = {},
): Promise<number> {
  return runThroughOutput(
    TRANSITION_COMMANDS[target],
    { args: [pathArg], flags: flags.by === undefined ? {} : { by: flags.by } },
    out,
    { sections: transitionLines },
  );
}

/** `phax artifact migrate-approvals`, kept as `runArtifactTransition` is. */
export function runArtifactMigrateApprovals(out: OutputPort): Promise<number> {
  return runThroughOutput(artifactMigrateApprovalsCommand, {}, out, {
    sections: renderMigrationReport,
  });
}

/** `phax artifact migrate-documents`, kept as `runArtifactTransition` is. */
export function runArtifactMigrateDocuments(out: OutputPort): Promise<number> {
  return runThroughOutput(artifactMigrateDocumentsCommand, {}, out, {
    sections: renderDocumentMigrationReport as (value: never) => readonly string[],
  });
}

/** `phax artifact new spec|plan` without `--headless` (src/cli/definitions/artifactNew.ts), kept
 *  as `runArtifactTransition` is. */
export function runCreateArtifact(
  kind: ArtifactKind,
  slug: string,
  sourceSpecArg: string | undefined,
  completion: CompletionFlags,
  out: OutputPort,
): Promise<number> {
  const command = kind === "spec" ? makeArtifactNewSpecCommand() : makeArtifactNewPlanCommand();
  const flags =
    kind === "spec"
      ? {}
      : {
          ...(sourceSpecArg === undefined ? {} : { spec: sourceSpecArg }),
          ...(completion.last ? { last: true } : {}),
          ...(completion.notLast ? { notLast: true } : {}),
        };
  return runThroughOutput(command as unknown as RunnerCommand<never>, { args: [slug], flags }, out);
}

type SchemaKind = ArtifactKind | "verdicts";

/** `phax artifact schema`, kept as `runArtifactTransition` is. */
export function runArtifactSchema(kind: SchemaKind, out: OutputPort): Promise<number> {
  return runThroughOutput(artifactSchemaCommand, { args: [kind] }, out, { wholeDocument: true });
}
