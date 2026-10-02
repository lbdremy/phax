import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { versionFromTag } from "../../scripts/releaseVersion.js";

const workflowPath = join(import.meta.dirname, "../../.github/workflows/release.yml");
const workflow = readFileSync(workflowPath, "utf-8");

describe("release workflow invariants", () => {
  it("triggers on v* tags", () => {
    expect(workflow).toContain("tags:");
    expect(workflow).toContain('"v*"');
  });

  it("includes a Deno setup step", () => {
    expect(workflow).toContain("denoland/setup-deno");
  });

  it("builds release binaries", () => {
    expect(workflow).toContain("pnpm deno:build-binaries");
  });

  it("generates checksums (uploads .sha256 files)", () => {
    expect(workflow).toContain(".sha256");
  });

  it("uploads artifacts to GitHub Release", () => {
    expect(workflow).toContain("softprops/action-gh-release");
  });

  it("runs npm stage publish with provenance", () => {
    expect(workflow).toContain("npm stage publish --access public --provenance");
  });

  it("uses GITHUB_TOKEN only (no NPM_TOKEN, no NODE_AUTH_TOKEN, no registry-url)", () => {
    expect(workflow).toContain("GITHUB_TOKEN");
    expect(workflow).not.toContain("NPM_TOKEN");
    expect(workflow).not.toContain("NODE_AUTH_TOKEN");
    expect(workflow).not.toContain("registry-url");
  });
});

interface Step {
  readonly name?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly "working-directory"?: string;
}

function jobSteps(path: string, job: string): ReadonlyArray<Step> {
  const parsed = parse(readFileSync(path, "utf-8")) as {
    readonly jobs: Readonly<Record<string, { readonly steps: ReadonlyArray<Step> }>>;
  };
  return parsed.jobs[job]!.steps;
}

const releaseSteps = jobSteps(workflowPath, "release");
const ciSteps = jobSteps(join(import.meta.dirname, "../../.github/workflows/ci.yml"), "ci");

const PUBLISH = "npm stage publish --access public --provenance";
const SMOKE = "pnpm exec tsx scripts/schemas-smoke.ts";

/** The index of the only step matching `match`. */
function indexOf(steps: ReadonlyArray<Step>, match: (step: Step) => boolean): number {
  const indexes = steps.flatMap((step, index) => (match(step) ? [index] : []));
  expect(indexes).toHaveLength(1);
  return indexes[0]!;
}

const runs = (command: string) => (step: Step) => step.run?.includes(command) === true;
const isSetupNode = (step: Step) => step.uses?.startsWith("actions/setup-node@") === true;
const nodeVersion = (step: Step) => String(step.with?.["node-version"]);

/** The last setup-node step before `index`. */
function setupNodeBefore(steps: ReadonlyArray<Step>, index: number): Step | undefined {
  return steps.slice(0, index).findLast(isSetupNode);
}

describe("release workflow: two packages in lockstep", () => {
  const publishes = releaseSteps.flatMap((step, index) =>
    step.run?.trim() === PUBLISH ? [index] : [],
  );
  const firstPublish = publishes[0]!;

  it("stage-publishes the wrapper, then the schemas package", () => {
    expect(publishes).toHaveLength(2);
    expect(releaseSteps[publishes[0]!]!["working-directory"]).toBe("npm");
    expect(releaseSteps[publishes[1]!]!["working-directory"]).toBe("packages/schemas");
  });

  it("runs every step that can fail before the first publish", () => {
    const beforePublish = [
      indexOf(releaseSteps, (step) => step.name === "Gate"),
      indexOf(releaseSteps, runs("pnpm deno:build-binaries")),
      indexOf(releaseSteps, runs(SMOKE)),
      indexOf(releaseSteps, runs("scripts/prepare-npm.ts")),
      indexOf(releaseSteps, (step) => step.name === "Verify package versions match tag"),
    ];
    for (const index of beforePublish) expect(index).toBeLessThan(firstPublish);
  });

  it("follows the first publish with only the second publish and the GitHub release", () => {
    const after = releaseSteps.slice(firstPublish + 1);
    expect(after).toHaveLength(2);
    expect(after[0]!.run?.trim()).toBe(PUBLISH);
    expect(after[1]!.uses).toMatch(/^softprops\/action-gh-release@/);
  });

  it("checks both manifests against the tag", () => {
    const check =
      releaseSteps[
        indexOf(releaseSteps, (step) => step.name === "Verify package versions match tag")
      ]!;
    expect(check.run).toContain("npm/package.json");
    expect(check.run).toContain("packages/schemas/package.json");
  });

  it("smokes the schemas package under Node 20", () => {
    const smoke = indexOf(releaseSteps, runs(SMOKE));
    expect(nodeVersion(setupNodeBefore(releaseSteps, smoke)!)).toBe("20");
  });

  it("upgrades npm after restoring Node 24 past the smoke, and before the first publish", () => {
    const smoke = indexOf(releaseSteps, runs(SMOKE));
    const upgrade = indexOf(releaseSteps, runs("npm install -g npm@"));
    expect(upgrade).toBeGreaterThan(smoke);
    expect(upgrade).toBeLessThan(firstPublish);
    const restore = setupNodeBefore(releaseSteps, upgrade)!;
    expect(releaseSteps.indexOf(restore)).toBeGreaterThan(smoke);
    expect(nodeVersion(restore)).toBe("24");
  });

  it("pins every setup-node step to the same SHA", () => {
    const pins = new Set(releaseSteps.filter(isSetupNode).map((step) => step.uses));
    expect(pins.size).toBe(1);
    expect([...pins][0]).toMatch(/^actions\/setup-node@[0-9a-f]{40}$/);
  });
});

describe("CI workflow: the schemas package smoke", () => {
  it("runs the smoke under Node 20, after the build", () => {
    const smoke = indexOf(ciSteps, runs(SMOKE));
    expect(nodeVersion(setupNodeBefore(ciSteps, smoke)!)).toBe("20");
    expect(indexOf(ciSteps, (step) => step.run === "pnpm build")).toBeLessThan(smoke);
  });

  it("pins every setup-node step to the same SHA", () => {
    const pins = new Set(ciSteps.filter(isSetupNode).map((step) => step.uses));
    expect(pins.size).toBe(1);
  });
});

// scripts/release.sh tags and pushes, so it never runs in a test: these read it as text.
const releaseScript = readFileSync(join(import.meta.dirname, "../../scripts/release.sh"), "utf-8");

describe("release script invariants", () => {
  it("cuts the schemas package's shapes before regenerating the usage spec", () => {
    const cut = releaseScript.indexOf("pnpm exec tsx scripts/release-cut.ts");
    expect(cut).toBeGreaterThan(-1);
    expect(cut).toBeLessThan(releaseScript.indexOf("pnpm gen:usage-spec"));
  });

  it("leaves the version bump to the cut", () => {
    expect(releaseScript).not.toContain("npm pkg set");
  });

  it("stays bash 3.2 compatible (no mapfile)", () => {
    expect(releaseScript).not.toContain("mapfile");
  });

  it("stages the cut's paths with git add -A, so renames and removals are staged", () => {
    expect(releaseScript).toContain('git add -A -- "${CUT_PATHS[@]}"');
  });

  it("ends by naming both staged npm packages", () => {
    const lastLines = releaseScript.trimEnd().split("\n").slice(-3);
    expect(lastLines).toEqual([
      'echo "approve the staged npm packages at:"',
      'echo "  https://www.npmjs.com/package/@lbdremy/phax"',
      'echo "  https://www.npmjs.com/package/@lbdremy/phax-schemas"',
    ]);
  });
});

describe("versionFromTag", () => {
  it("strips the leading v from a semver tag", () => {
    expect(versionFromTag("v1.2.3")).toBe("1.2.3");
  });

  it("handles patch version zero", () => {
    expect(versionFromTag("v0.1.0")).toBe("0.1.0");
  });

  it("handles multi-digit segments", () => {
    expect(versionFromTag("v10.20.30")).toBe("10.20.30");
  });

  it("throws for missing v prefix", () => {
    expect(() => versionFromTag("1.2.3")).toThrow("Malformed tag");
  });

  it("throws for a two-part version", () => {
    expect(() => versionFromTag("v1.2")).toThrow("Malformed tag");
  });

  it("throws for a non-numeric segment", () => {
    expect(() => versionFromTag("v1.2.x")).toThrow("Malformed tag");
  });

  it("throws for an empty string", () => {
    expect(() => versionFromTag("")).toThrow("Malformed tag");
  });

  it("throws for a pre-release suffix", () => {
    expect(() => versionFromTag("v1.2.3-beta.1")).toThrow("Malformed tag");
  });
});
