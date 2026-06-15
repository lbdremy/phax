// Prepare the npm wrapper for a release tag by version-matching npm/package.json.
// Export: versionFromTag(tag) — pure, unit-tested by releaseWorkflow.test.ts
import { join } from "node:path";

export function versionFromTag(tag: string): string {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Malformed tag: "${tag}". Expected format: v<major>.<minor>.<patch>`);
  }
  return tag.slice(1);
}

if (import.meta.main) {
  const tag = Deno.args[0];
  if (!tag) {
    console.error("Usage: deno run scripts/prepare-npm.ts <tag>");
    Deno.exit(1);
  }

  const version = versionFromTag(tag);
  const pkgPath = join(new URL("../npm/package.json", import.meta.url).pathname);
  const pkg = JSON.parse(await Deno.readTextFile(pkgPath)) as Record<string, unknown>;
  pkg["version"] = version;
  await Deno.writeTextFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

  const written = JSON.parse(await Deno.readTextFile(pkgPath)) as Record<string, unknown>;
  if (written["version"] !== version) {
    console.error(
      `Version mismatch after write: expected ${version}, got ${String(written["version"])}`,
    );
    Deno.exit(1);
  }

  console.log(`npm/package.json version set to ${version}`);
}
