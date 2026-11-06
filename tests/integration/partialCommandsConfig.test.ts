import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Either } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/app/loadConfig.js";
import { isolateGit } from "../helpers/isolateGit.js";
import { disableGitAutoMaintenance, removeTempDir } from "../helpers/tempGit.js";

// Acceptance tests for `partial` on a gate step (config surface), frozen ahead
// of the parser and the load-time refusals. Every test is an expected failure
// until the plan's phase-02 makes it pass; then the markers come off.
//
// Base fixture: gateProfiles.standard has six steps. Step [3] is `pnpm lint`,
// step [5] is `pnpm build`. The overlay file is phax.local.json and its profile
// is `overlay`.

let repoDir: string;
let tempHome: string;
let originalHome: string | undefined;
let restoreGit: () => void;

beforeEach(() => {
  restoreGit = isolateGit();
  repoDir = mkdtempSync(join(tmpdir(), "phax-partial-config-"));
  execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
  disableGitAutoMaintenance(repoDir);
  tempHome = mkdtempSync(join(tmpdir(), "phax-partial-config-home-"));
  mkdirSync(join(tempHome, ".phax"), { recursive: true });
  originalHome = process.env["HOME"];
  process.env["HOME"] = tempHome;
});

afterEach(() => {
  if (originalHome === undefined) delete process.env["HOME"];
  else process.env["HOME"] = originalHome;
  restoreGit();
  removeTempDir(repoDir);
  removeTempDir(tempHome);
});

type Step = Record<string, unknown>;

function step(command: string, extra: Step = {}): Step {
  return { command, surface: "local", firing: "every-phase", ...extra };
}

function standardSteps(step3: Step = step("pnpm lint"), step5: Step = step("pnpm build")): Step[] {
  return [
    step("pnpm format"),
    step("pnpm typecheck"),
    step("pnpm test"),
    step3,
    step("pnpm knip"),
    step5,
  ];
}

function writeProject(steps: Step[]): void {
  writeFileSync(
    join(repoDir, "phax.json"),
    JSON.stringify({ version: 1, name: "test", gateProfiles: { standard: steps } }),
  );
}

function writeOverlay(overlay: object): void {
  writeFileSync(join(repoDir, "phax.local.json"), JSON.stringify(overlay));
}

function message(result: ReturnType<typeof loadConfig>): string {
  expect(Either.isLeft(result)).toBe(true);
  return Either.isLeft(result) ? result.left.message : "";
}

function partialOf(steps: readonly unknown[] | undefined, index: number): unknown {
  const found = steps?.[index];
  return (found as Record<string, unknown> | undefined)?.["partial"];
}

const BOTH = {
  files: "pnpm exec oxlint <files>",
  diff: "git diff --name-only --diff-filter=d | xargs pnpm exec oxlint",
};

describe("partial on a gate step: accepted", () => {
  // ac-accepted
  it("loads both variants in phax.json and a files-only step in the user overlay", () => {
    writeProject(standardSteps(step("pnpm lint", { partial: BOTH })));
    const overlayPartial = { files: "pnpm exec vitest run <files>" };
    writeOverlay({ gateProfiles: { overlay: [step("pnpm test", { partial: overlayPartial })] } });
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      const profiles = result.right.raw.gateProfiles;
      expect(partialOf(profiles["standard"], 3)).toEqual(BOTH);
      expect(partialOf(profiles["overlay"], 0)).toEqual(overlayPartial);
    }
  });
});

describe("partial on a gate step: shape refusals", () => {
  // ac-empty-refused
  it("refuses an empty partial, naming the bracketed step path", () => {
    writeProject(standardSteps(step("pnpm lint", { partial: {} })));
    expect(message(loadConfig(repoDir))).toContain("gateProfiles.standard[3].partial");
  });

  // ac-empty-refused
  it("refuses a partial with an unknown key, naming the bracketed step path", () => {
    writeProject(standardSteps(step("pnpm lint", { partial: { all: "pnpm exec oxlint ." } })));
    expect(message(loadConfig(repoDir))).toContain("gateProfiles.standard[3].partial");
  });
});

describe("partial on a gate step: placeholders", () => {
  // ac-files-placeholder
  it("refuses a files command without a placeholder", () => {
    writeProject(
      standardSteps(
        step("pnpm lint"),
        step("pnpm build", { partial: { files: "pnpm exec oxlint src" } }),
      ),
    );
    expect(message(loadConfig(repoDir))).toContain("gateProfiles.standard[5].partial.files");
  });

  // ac-diff-placeholder
  it("refuses a diff command with a placeholder", () => {
    writeProject(
      standardSteps(step("pnpm lint", { partial: { diff: "pnpm exec oxlint <files>" } })),
    );
    expect(message(loadConfig(repoDir))).toContain("gateProfiles.standard[3].partial.diff");
  });
});

describe("partial on a gate step: compound and nested constructs", () => {
  const refused: readonly (readonly [string, string, string])[] = [
    [";", "git diff --name-only; ls", '";"'],
    ["&&", "git diff --name-only && ls", '"&&"'],
    ["||", "git diff --name-only || ls", '"||"'],
    ["a lone &", "ls &", '"&"'],
    ["$(", "pnpm exec oxlint $(git diff --name-only)", '"$("'],
    ["a backtick", "pnpm exec oxlint `git diff --name-only`", '"`"'],
    ["a line break", "git diff --name-only\nls", "line break"],
    [">", "ls > out.txt", '">"'],
    [">>", "ls >> out.txt", '">>"'],
    ["a bare <", "wc -l < a.txt", '"<"'],
  ];

  // ac-compound-refused
  it.each(refused)("refuses %s in a diff command", (_name, command, construct) => {
    writeProject(standardSteps(step("pnpm lint", { partial: { diff: command } })));
    const text = message(loadConfig(repoDir));
    expect(text).toContain("gateProfiles.standard[3].partial.diff");
    expect(text).toContain(construct);
  });

  // ac-compound-refused
  it("names the overlay's profile path when the user overlay holds the refusal", () => {
    writeProject(standardSteps());
    writeOverlay({
      gateProfiles: { overlay: [step("pnpm lint", { partial: { diff: "ls; ls" } })] },
    });
    const text = message(loadConfig(repoDir));
    expect(text).toContain("gateProfiles.overlay[0].partial.diff");
    expect(text).toContain('";"');
  });

  // ac-compound-refused
  it("accepts a plain pipe in a diff command", () => {
    writeProject(standardSteps(step("pnpm lint", { partial: { diff: "ls | xargs wc -l" } })));
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(partialOf(result.right.raw.gateProfiles["standard"], 3)).toEqual({
        diff: "ls | xargs wc -l",
      });
    }
  });

  // ac-compound-refused
  it("accepts a files command with a placeholder", () => {
    writeProject(
      standardSteps(step("pnpm lint", { partial: { files: "pnpm exec oxlint <files>" } })),
    );
    const result = loadConfig(repoDir);
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(partialOf(result.right.raw.gateProfiles["standard"], 3)).toEqual({
        files: "pnpm exec oxlint <files>",
      });
    }
  });
});
