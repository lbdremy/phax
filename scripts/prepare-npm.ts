// Prepare the npm wrapper for a release tag: version-match npm/package.json
// and write npm/README.md from the repository's README (scripts/npmReadme.ts).
import { join } from "node:path";
import { npmReadme } from "./npmReadme.ts";
import { versionFromTag } from "./releaseVersion.ts";

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

  const readmePath = join(new URL("../README.md", import.meta.url).pathname);
  const npmReadmePath = join(new URL("../npm/README.md", import.meta.url).pathname);
  await Deno.writeTextFile(npmReadmePath, npmReadme(await Deno.readTextFile(readmePath), tag));
  console.log(`npm/README.md written from README.md, links pinned at ${tag}`);
}
