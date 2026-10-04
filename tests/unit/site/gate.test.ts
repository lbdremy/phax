import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "../../..");

interface GateStep {
  readonly command: string;
  readonly surface: string;
  readonly firing: string;
}

const phaxConfig = JSON.parse(readFileSync(join(root, "phax.json"), "utf-8")) as {
  readonly gateProfiles: Readonly<Record<string, ReadonlyArray<GateStep>>>;
};
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as {
  readonly scripts: Readonly<Record<string, string>>;
};

const standard = phaxConfig.gateProfiles["standard"]!;
const siteSteps = standard.filter((step) => step.command.includes("site:"));

describe("phax standard gate: the docs site", () => {
  it("runs pnpm site:build exactly once, as a terminal product step", () => {
    expect(siteSteps).toEqual([
      { command: "pnpm site:build", surface: "product", firing: "terminal" },
    ]);
  });

  it("places the site build right after the pnpm build terminal step", () => {
    const build = standard.findIndex((step) => step.command === "pnpm build");
    expect(standard[build + 1]!.command).toBe("pnpm site:build");
  });

  it("adds no every-phase step that mentions the site", () => {
    const everyPhase = standard.filter((step) => step.firing === "every-phase");
    expect(everyPhase.some((step) => step.command.includes("site:"))).toBe(false);
  });
});

describe("package scripts: the site build stays out of the fast checks", () => {
  it.each(["check:full", "test"])("%s does not run the site build", (script) => {
    expect(packageJson.scripts[script]).not.toContain("site:build");
  });
});
