import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Duration, Effect } from "effect";
import { readUsageSpec } from "./usageSpec.js";

export function readPackageVersion(): string {
  // Resolve 2 levels up from src/cli/commands/ (dev) or dist/cli/commands/ (installed)
  // to get to the package root where package.json lives.
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

// `process.exit()` right after `process.stdout/stderr.write()` can truncate the
// write: for a non-TTY pipe (as in a spawned child), Node writes larger than
// PIPE_BUF asynchronously, and an immediate exit races the flush. Exiting only
// from the write's completion callback guarantees the data is handed off
// before the process terminates. `onDone` is the caller's `process.exit(code)`.
function handleUsageFlag(format: string, onDone: (code: number) => void): void {
  if (format !== "kdl" && format !== "json") {
    process.stderr.write(
      `Error: invalid --usage-format value "${format}". Valid choices: kdl, json\n`,
      () => onDone(1),
    );
    return;
  }

  const spec = readUsageSpec();
  if (!spec.found) {
    process.stderr.write(
      `Error: phax.usage.kdl not found at ${spec.path}\n` +
        "If running from source, regenerate it with: pnpm gen:usage-spec\n",
      () => onDone(1),
    );
    return;
  }

  if (format === "json") {
    const result = spawnSync("usage", ["generate", "json", "-f", "-"], {
      encoding: "utf8",
      input: spec.content,
      env: { ...process.env },
    });

    if (result.error !== undefined) {
      const isNotFound =
        (result.error as NodeJS.ErrnoException).code === "ENOENT" ||
        result.error.message.includes("ENOENT");
      if (isNotFound) {
        process.stderr.write(
          "Error: The `usage` CLI is required for --usage-format json but was not found on PATH.\n" +
            "Install it with: brew install usage\n" +
            "See https://usage.jdx.dev/cli/ for other install options.\n" +
            "Tip: Run `phax --usage` (without --usage-format) for the KDL format, which has no external dependency.\n",
          () => onDone(1),
        );
        return;
      }
      throw result.error;
    }

    if (result.status !== 0) {
      const errOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
      process.stderr.write(
        `Error: usage generate json failed (exit ${result.status}):\n${errOutput}\n`,
        () => onDone(1),
      );
      return;
    }

    process.stdout.write(result.stdout, () => onDone(0));
    return;
  }

  // format === "kdl"
  process.stdout.write(spec.content, () => onDone(0));
}

// Upper bound on how long we wait for the --usage write callback to fire. A
// stuck pipe would otherwise leave the process hanging forever; past the
// deadline we exit non-zero instead.
const USAGE_WRITE_TIMEOUT = Duration.seconds(5);
const USAGE_WRITE_TIMEOUT_EXIT_CODE = 1;

// Run `handleUsageFlag` and terminate the process with the resulting exit code.
// Effect races the write-completion callback against a timeout so a wedged
// write can never hang the CLI: whichever resolves first decides the code.
export function runUsageFlagAndExit(format: string): Promise<void> {
  const exitCode = Effect.async<number>((resume) => {
    handleUsageFlag(format, (code) => resume(Effect.succeed(code)));
  }).pipe(
    Effect.timeoutTo({
      duration: USAGE_WRITE_TIMEOUT,
      onSuccess: (code) => code,
      onTimeout: () => {
        process.stderr.write("Error: timed out flushing --usage output.\n");
        return USAGE_WRITE_TIMEOUT_EXIT_CODE;
      },
    }),
  );
  return Effect.runPromise(exitCode).then((code) => {
    process.exit(code);
  });
}
