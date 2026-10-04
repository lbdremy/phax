import { spawnSync } from "node:child_process";
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
  readonly id?: string;
  readonly uses?: string;
  readonly run?: string;
  readonly if?: unknown;
  readonly "continue-on-error"?: unknown;
  readonly env?: Readonly<Record<string, string>>;
  readonly with?: Readonly<Record<string, unknown>>;
  readonly "working-directory"?: string;
}

interface Job {
  readonly env?: Readonly<Record<string, string>>;
  readonly steps: ReadonlyArray<Step>;
}

interface Workflow {
  readonly on?: unknown;
  readonly env?: Readonly<Record<string, string>>;
  readonly permissions?: unknown;
  readonly jobs: Readonly<Record<string, Job>>;
}

function parseWorkflow(path: string): Workflow {
  return parse(readFileSync(path, "utf-8")) as Workflow;
}

function jobSteps(path: string, job: string): ReadonlyArray<Step> {
  return parseWorkflow(path).jobs[job]!.steps;
}

const releaseSteps = jobSteps(workflowPath, "release");
const ciSteps = jobSteps(join(import.meta.dirname, "../../.github/workflows/ci.yml"), "ci");

const PUBLISH = "npm stage publish --access public --provenance";
const SMOKE = "pnpm exec tsx scripts/schemas-smoke.ts";
const DEPLOY_STEPS = [
  "Deploy docs: guard",
  "Deploy docs: upload",
  "Deploy docs: check preview",
  "Deploy docs: promote",
] as const;

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

  it("stage-publishes the schemas package, then the wrapper", () => {
    expect(publishes).toHaveLength(2);
    expect(releaseSteps[publishes[0]!]!["working-directory"]).toBe("packages/schemas");
    expect(releaseSteps[publishes[1]!]!["working-directory"]).toBe("npm");
  });

  // --provenance and trusted publishing reject a manifest whose repository
  // does not name the repo the workflow runs in.
  it.each(["npm", "packages/schemas"])("%s/package.json names the phax repository", (dir) => {
    const manifest = JSON.parse(
      readFileSync(join(import.meta.dirname, "../..", dir, "package.json"), "utf-8"),
    ) as { readonly repository?: { readonly type?: string; readonly url?: string } };
    expect(manifest.repository?.type).toBe("git");
    expect(manifest.repository?.url).toBe("git+https://github.com/lbdremy/phax.git");
  });

  it("runs every step that can fail before the first publish", () => {
    const beforePublish = [
      indexOf(releaseSteps, (step) => step.name === "Gate"),
      indexOf(releaseSteps, runs("pnpm deno:build-binaries")),
      indexOf(releaseSteps, runs(SMOKE)),
      indexOf(releaseSteps, runs("scripts/prepare-npm.ts")),
      indexOf(releaseSteps, (step) => step.name === "Verify package versions match tag"),
      ...DEPLOY_STEPS.map((name) => indexOf(releaseSteps, (step) => step.name === name)),
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

/** The deploy steps of `steps`, in workflow order. */
const deploySteps = (steps: ReadonlyArray<Step>) =>
  steps.filter((step) => step.name?.startsWith("Deploy docs:") === true);

const mentionsCloudflare = (value: unknown) => JSON.stringify(value ?? {}).includes("CLOUDFLARE");

/** The actions `steps` use, as `owner/name@sha`. */
const actionPins = (steps: ReadonlyArray<Step>) =>
  steps.flatMap((step) => (step.uses === undefined ? [] : [step.uses]));

describe("release workflow: the docs site deploy", () => {
  const release = parseWorkflow(workflowPath);
  const step = (name: string) => releaseSteps[indexOf(releaseSteps, (s) => s.name === name)]!;
  const firstPublish = releaseSteps.findIndex((s) => s.run?.trim() === PUBLISH);

  it("builds the site in the Gate, after pnpm build", () => {
    const gate = step("Gate")
      .run!.split("\n")
      .map((line) => line.trim());
    expect(gate.filter((line) => line === "pnpm site:build")).toHaveLength(1);
    expect(gate.indexOf("pnpm build")).toBeLessThan(gate.indexOf("pnpm site:build"));
  });

  it("runs guard, upload, check, promote in order, after the version check and before the first publish", () => {
    expect(deploySteps(releaseSteps).map((s) => s.name)).toEqual([...DEPLOY_STEPS]);
    const indexes = DEPLOY_STEPS.map((name) => releaseSteps.indexOf(step(name)));
    expect(indexes).toEqual(indexes.toSorted((left, right) => left - right));
    const check = releaseSteps.indexOf(step("Verify package versions match tag"));
    expect(indexes[0]).toBe(check + 1);
    expect(indexes[3]).toBe(firstPublish - 1);
  });

  it("sets the release tag and wrangler's output file for the job", () => {
    expect(release.jobs["release"]!.env).toEqual({
      RELEASE_TAG: "${{ github.ref_name }}",
      WRANGLER_OUTPUT_FILE_PATH: "${{ runner.temp }}/wrangler-output.ndjson",
    });
  });

  it("guards with the deploy guard and checks the preview with the preview check", () => {
    expect(step("Deploy docs: guard").run).toBe("pnpm exec tsx site/build/deploy-guard.ts");
    expect(step("Deploy docs: check preview").run).toBe(
      'pnpm exec tsx site/build/preview-check.ts --upload-output "$WRANGLER_OUTPUT_FILE_PATH" --tag "$RELEASE_TAG"',
    );
  });

  it("uploads to a preview alias derived from the tag: v0.18.0 → v0-18-0", () => {
    const upload = step("Deploy docs: upload").run!;
    expect(upload).toContain("pnpm exec wrangler versions upload --config site/wrangler.jsonc");
    expect(upload).toContain('--tag "$RELEASE_TAG"');
    const alias = /--preview-alias "([^"]+)"/.exec(upload)?.[1];
    expect(alias).toBe("${RELEASE_TAG//./-}");
    const evaluated = spawnSync("bash", ["-c", `printf '%s' "${alias}"`], {
      env: { PATH: process.env["PATH"], RELEASE_TAG: "v0.18.0" },
      encoding: "utf8",
    });
    expect(evaluated.stdout).toBe("v0-18-0");
  });

  it("promotes the version the preview check passed, non-interactively", () => {
    const check = step("Deploy docs: check preview");
    expect(check.id).toBe("preview");
    const promote = step("Deploy docs: promote");
    expect(releaseSteps.indexOf(promote)).toBeGreaterThan(releaseSteps.indexOf(check));
    expect(promote.run).toBe(
      'pnpm exec wrangler versions deploy "${{ steps.preview.outputs.version-id }}@100%" --config site/wrangler.jsonc --yes',
    );
  });

  it("lets no deploy step continue on error or run conditionally", () => {
    for (const deploy of deploySteps(releaseSteps)) {
      expect(deploy).not.toHaveProperty("continue-on-error");
      expect(deploy).not.toHaveProperty("if");
    }
  });

  it("hands the Cloudflare credential to the upload and promote steps only", () => {
    expect(mentionsCloudflare(release.env)).toBe(false);
    expect(mentionsCloudflare(release.jobs["release"]!.env)).toBe(false);
    const holders = releaseSteps.filter(mentionsCloudflare).map((s) => s.name);
    expect(holders).toEqual(["Deploy docs: upload", "Deploy docs: promote"]);
    for (const name of holders) {
      expect(step(name!).env).toEqual({
        CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
        CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
      });
    }
  });
});

describe("docs-deploy workflow: redeploying a released tag by hand", () => {
  const docsDeployPath = join(import.meta.dirname, "../../.github/workflows/docs-deploy.yml");
  const docsDeploy = parseWorkflow(docsDeployPath);
  const job = docsDeploy.jobs["deploy"]!;
  const steps = job.steps;

  it("runs only on a manual dispatch with a required tag, reading contents only", () => {
    expect(docsDeploy.on).toEqual({
      workflow_dispatch: {
        inputs: {
          tag: { description: expect.any(String), required: true, type: "string" },
        },
      },
    });
    expect(docsDeploy.permissions).toEqual({ contents: "read" });
    expect(Object.keys(docsDeploy.jobs)).toEqual(["deploy"]);
  });

  it("passes the tag through the environment, never interpolated into a run", () => {
    expect(job.env).toEqual({
      RELEASE_TAG: "${{ inputs.tag }}",
      WRANGLER_OUTPUT_FILE_PATH: "${{ runner.temp }}/wrangler-output.ndjson",
    });
    for (const s of steps) expect(s.run ?? "").not.toContain("inputs.");
  });

  it("checks out the tag", () => {
    const checkout =
      steps[indexOf(steps, (s) => s.uses?.startsWith("actions/checkout@") === true)]!;
    expect(checkout.with).toEqual({ ref: "${{ inputs.tag }}" });
    expect(steps.indexOf(checkout)).toBe(0);
  });

  it("pins checkout, pnpm and setup-node 24 to release.yml's SHAs", () => {
    for (const action of ["actions/checkout@", "pnpm/action-setup@", "actions/setup-node@"]) {
      const own = actionPins(steps).filter((uses) => uses.startsWith(action));
      expect(own).toHaveLength(1);
      expect(actionPins(releaseSteps)).toContain(own[0]);
    }
    expect(nodeVersion(steps.find(isSetupNode)!)).toBe("24");
  });

  it("refuses a tag that is not vX.Y.Z or not package.json's version, before building", () => {
    const verify = indexOf(steps, (s) => s.name === "Verify the tag is this release");
    expect(steps[verify]!.run).toContain("^v[0-9]+\\.[0-9]+\\.[0-9]+$");
    expect(steps[verify]!.run).toContain("package.json");
    expect(verify).toBeLessThan(indexOf(steps, runs("pnpm site:build")));
  });

  it("builds the site, then runs release.yml's four deploy steps verbatim", () => {
    const build = indexOf(steps, runs("pnpm site:build"));
    expect(indexOf(steps, runs("pnpm install"))).toBeLessThan(build);
    const deploys = deploySteps(steps);
    expect(deploys).toEqual(deploySteps(releaseSteps));
    expect(steps.slice(build + 1)).toEqual(deploys);
  });

  it("publishes nothing: no npm publish, no GitHub Release, no npm token", () => {
    const text = readFileSync(docsDeployPath, "utf-8");
    expect(text).not.toContain("npm stage publish");
    expect(text).not.toContain("npm publish");
    expect(text).not.toContain("action-gh-release");
    expect(text).not.toContain("NPM_TOKEN");
    expect(text).not.toContain("NODE_AUTH_TOKEN");
  });
});

describe("CI workflow: the docs site build", () => {
  it("runs pnpm site:build exactly once, after the pnpm build step", () => {
    const site = indexOf(ciSteps, runs("pnpm site:build"));
    expect(indexOf(ciSteps, (step) => step.run === "pnpm build")).toBeLessThan(site);
  });

  it("never deploys: no wrangler step and no Cloudflare secret", () => {
    const ci = readFileSync(join(import.meta.dirname, "../../.github/workflows/ci.yml"), "utf-8");
    expect(ci).not.toContain("wrangler");
    expect(ci).not.toContain("CLOUDFLARE");
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
