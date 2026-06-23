import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function readPackageVersion(): string {
  // Resolve 2 levels up from src/cli/commands/ (dev) or dist/cli/commands/ (installed)
  // to get to the package root where package.json lives.
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "../../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
  return pkg.version;
}

function resolveSpecPath(): string {
  // Walk up 3 levels: commands/ → cli/ → src|dist/ → package root.
  // Works in both dev layout (src/cli/commands/) and installed layout (dist/cli/commands/).
  return join(dirname(fileURLToPath(import.meta.url)), "../../../phax.usage.kdl");
}

export function handleUsageFlag(format: string): void {
  if (format !== "kdl" && format !== "json") {
    process.stderr.write(
      `Error: invalid --usage-format value "${format}". Valid choices: kdl, json\n`,
    );
    process.exit(1);
  }

  const specPath = resolveSpecPath();
  if (!existsSync(specPath)) {
    process.stderr.write(
      `Error: phax.usage.kdl not found at ${specPath}\n` +
        "If running from source, regenerate it with: pnpm gen:usage-spec\n",
    );
    process.exit(1);
  }

  if (format === "json") {
    const result = spawnSync("usage", ["generate", "json", "-f", specPath], {
      encoding: "utf8",
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
        );
        process.exit(1);
      }
      throw result.error;
    }

    if (result.status !== 0) {
      const errOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
      process.stderr.write(
        `Error: usage generate json failed (exit ${result.status}):\n${errOutput}\n`,
      );
      process.exit(1);
    }

    process.stdout.write(result.stdout);
    return;
  }

  // format === "kdl"
  const kdl = readFileSync(specPath, "utf8");
  process.stdout.write(kdl);
}
