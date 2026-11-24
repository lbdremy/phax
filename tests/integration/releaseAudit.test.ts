import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { boundedSpawn, SCRIPT_BOUND_MS } from "../helpers/boundedSpawn.js";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");

const dirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("release audit on the npm launcher", () => {
  // The exit status is not asserted: other sections of the audit decide it.
  it("recognises the launcher's checksum verification and redirect host check", () => {
    const result = boundedSpawn("bash", ["scripts/security/release-audit.sh"], {
      boundMs: SCRIPT_BOUND_MS,
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        AUDIT_OUT_DIR: tempDir("phax-release-audit-out-"),
        HOME: tempDir("phax-release-audit-home-"),
        npm_config_cache: tempDir("phax-release-audit-npm-"),
        NO_COLOR: "1",
      },
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(output).toContain("npm installer verifies a checksum before executing the binary");
    expect(output).not.toContain("Installer follows HTTP redirects without host validation");
  });
});
