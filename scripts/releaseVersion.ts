// The npm package version a release tag carries. Pure, and free of Deno APIs so
// the Node test suite can typecheck and unit-test it (releaseWorkflow.test.ts);
// scripts/prepare-npm.ts is the Deno entry point that applies it.
export function versionFromTag(tag: string): string {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(`Malformed tag: "${tag}". Expected format: v<major>.<minor>.<patch>`);
  }
  return tag.slice(1);
}
