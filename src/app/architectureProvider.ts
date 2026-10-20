import { Effect, Either } from "effect";
import { architectureRequest } from "../domain/architecture/request.js";
import { onOneLine } from "../domain/reportText.js";
import { resolveTreePaths } from "../domain/treePaths.js";
import type { Shell } from "../ports/shell.js";
import type { ArchitectureReport } from "../schemas/architecture.js";
import {
  describeReportError,
  readArchitectureReport,
  withSchemaUrl,
} from "../schemas/persisted.js";
import { runProviderQuery, type ProviderQueryFailure } from "./providerQuery.js";

/**
 * The architecture provider's wall-clock limit. Fixed, not a config key: an
 * architecture call informs, so it must never hold a `phax architecture` call
 * for long. It has the brief's value but is its own constant, so the two
 * providers' limits can differ.
 */
export const ARCHITECTURE_TIMEOUT_MS = 60_000;

/**
 * What one `phax architecture` call comes to. `reason` and `message` are one
 * line; `report` is the decoded architecture report without `$schema`, its body
 * and its text untouched.
 */
export type PullArchitectureResult =
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "answered"; readonly report: ArchitectureReport }
  | { readonly kind: "failed"; readonly reason: string };

function failureReason(failure: ProviderQueryFailure): string {
  const stderr = failure.stderrExcerpt?.trim();
  return stderr ? `${failure.message}: ${stderr}` : failure.message;
}

/**
 * One `phax architecture` call: asks the provider once, with no shell, run from
 * `root`, the stamped request on stdin. With no path `files` is null (the whole
 * repository); otherwise the paths are resolved against `cwd` and made
 * root-relative. A path outside the tree is refused before the provider runs.
 * The answer is read as an architecture report by its own `$schema`. Nothing
 * is written and this never fails: every problem is a refusal or a failure.
 */
export function pullArchitecture(input: {
  readonly command: string;
  /** The root of the working tree the call is made in. */
  readonly root: string;
  /** The directory the paths are relative to. */
  readonly cwd: string;
  readonly paths: readonly string[];
  /** Tests only: no config key or flag reaches it. */
  readonly timeoutMs?: number;
}): Effect.Effect<PullArchitectureResult, never, Shell> {
  return Effect.gen(function* () {
    const [first, ...rest] = input.paths;
    let files: readonly [string, ...string[]] | null = null;
    if (first !== undefined) {
      const resolved = resolveTreePaths({
        cwd: input.cwd,
        root: input.root,
        paths: [first, ...rest],
      });
      if (Either.isLeft(resolved)) {
        return { kind: "refused", message: onOneLine(resolved.left.refused) } as const;
      }
      files = resolved.right;
    }

    const request = withSchemaUrl("architecture-request", architectureRequest(files));
    const ran = yield* runProviderQuery(
      "architecture provider",
      input.command,
      input.root,
      request,
      (raw: unknown) => Either.right(raw),
      (failure) => failure,
      { timeoutMs: input.timeoutMs ?? ARCHITECTURE_TIMEOUT_MS },
    );
    if (Either.isLeft(ran)) {
      return { kind: "failed", reason: onOneLine(failureReason(ran.left)) } as const;
    }
    const report = readArchitectureReport(ran.right);
    if (Either.isLeft(report)) {
      return {
        kind: "failed",
        reason: onOneLine(`architecture provider: ${describeReportError(report.left)}`),
      } as const;
    }
    const { body, parts } = report.right;
    return { kind: "answered", report: { body, parts } } as const;
  });
}
