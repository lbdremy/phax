import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VALID_SHELLS = ["zsh", "bash", "fish", "nu", "powershell"] as const;
type Shell = (typeof VALID_SHELLS)[number];

function resolveSpecPath(): string {
  // Walk up 3 levels: commands/ → cli/ → src|dist/ → package root.
  return join(dirname(fileURLToPath(import.meta.url)), "../../../phax.usage.kdl");
}

export function runCompletions(shell: string): void {
  if (!VALID_SHELLS.includes(shell as Shell)) {
    process.stderr.write(
      `Error: invalid shell "${shell}". Valid choices: ${VALID_SHELLS.join(", ")}\n` +
        `Run \`phax completions --help\` for usage.\n`,
    );
    process.exit(1);
  }

  const specPath = resolveSpecPath();
  if (!existsSync(specPath)) {
    process.stderr.write(
      `Error: phax.usage.kdl not found at ${specPath}\n` +
        "If running from source, ensure the spec exists at the repo root.\n",
    );
    process.exit(1);
  }

  const result = spawnSync("usage", ["generate", "completion", shell, "phax", "-f", specPath], {
    encoding: "utf8",
    env: { ...process.env },
  });

  if (result.error !== undefined) {
    const isNotFound =
      (result.error as NodeJS.ErrnoException).code === "ENOENT" ||
      result.error.message.includes("ENOENT");
    if (isNotFound) {
      process.stderr.write(
        "Error: The `usage` CLI is required to generate shell completions but was not found on PATH.\n" +
          "Install it with: brew install usage\n" +
          "See https://usage.jdx.dev/cli/ for other install options.\n",
      );
      process.exit(1);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    const errOutput = [result.stdout, result.stderr].filter(Boolean).join("\n");
    process.stderr.write(
      `Error: usage generate completion failed (exit ${result.status ?? "unknown"}):\n${errOutput}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(result.stdout);
}
