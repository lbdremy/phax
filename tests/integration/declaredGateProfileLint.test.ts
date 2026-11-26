/**
 * `phax plans lint` resolves the plan's declared gate profile by the run's rule
 * (spec §5.8, §5.9; q-lint-check): an undefined one is one `gate-profile` error
 * naming every defined profile, and the `commands` check compares the required
 * commands with the declared profile's steps alone, or is skipped when the
 * profile is undefined.
 *
 * Each test lints a made-up plan.md through the real `phax plans lint` in a
 * temporary git repository with its own phax.json. The routing loaders serve
 * the built-in defaults and the PHAX home is a temporary directory.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentSchemaUrl } from "../../src/schemas/persisted.js";
import { decodePlanLintFile, type PlanLintDocument } from "../../src/schemas/planLint.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { phaxCall } from "../helpers/runnerCall.js";
import {
  createPreflightRepo,
  type PreflightRepo,
  removePreflightRepo,
} from "./helpers/preflightRepo.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);
// The routing loaders read ~/.phax; serve the built-in defaults instead.
vi.mock("../../src/app/loadRouting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/app/loadRouting.js")>();
  const effect = await import("effect");
  const defaults = await import("../../src/domain/routing/defaults.js");
  return {
    ...actual,
    loadModelRouting: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_MODEL_ROUTING)),
    loadProviderConfig: vi.fn(() => effect.Effect.succeed(defaults.DEFAULT_PROVIDER_CONFIG)),
  };
});

type Profile = "light" | "standard";

const STEPS: Record<Profile, readonly object[]> = {
  standard: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
  light: [{ command: "pnpm lint", surface: "local", firing: "every-phase" }],
};

function phaxJson(r: PreflightRepo, profiles: readonly Profile[]): string {
  return (
    JSON.stringify(
      {
        version: 1,
        name: r.namespace,
        state: { root: r.stateRoot },
        gateProfiles: Object.fromEntries(profiles.map((id) => [id, STEPS[id]])),
        publish: { auto: false },
        review: { compliance: { enabled: false } },
      },
      null,
      2,
    ) + "\n"
  );
}

type LintFinding = PlanLintDocument["findings"][number];

let phaxHome: ReturnType<typeof isolatePhaxHome>;
let roots: PreflightRepo | undefined;
let origCwd: string;

beforeEach(() => {
  phaxHome = isolatePhaxHome();
  origCwd = process.cwd();
});

afterEach(() => {
  process.chdir(origCwd);
  removePreflightRepo(roots);
  roots = undefined;
  phaxHome.restore();
});

/**
 * A repository whose phax.json defines `profiles`, holding plan.md: one phase at
 * the policy default (so no models finding), declaring `declared`, requiring
 * `requiredCommands`.
 */
function project(
  profiles: readonly Profile[],
  declared: Profile,
  requiredCommands: readonly string[] = [],
): PreflightRepo {
  const r = createPreflightRepo({
    plan: { requiredCommands, phases: [{ model: "claude-sonnet-5-5" }] },
  });
  roots = r;
  writeFileSync(join(r.repo, "phax.json"), phaxJson(r, profiles));
  const planPath = join(r.repo, "plan.md");
  const planMd = readFileSync(planPath, "utf8");
  const rewritten = planMd.replace(
    "## Gate profile\n\n`standard`\n",
    `## Gate profile\n\n\`${declared}\`\n`,
  );
  if (!rewritten.includes(`\`${declared}\``)) throw new Error("the fixture plan.md declares none");
  writeFileSync(planPath, rewritten);
  process.chdir(r.repo);
  return r;
}

async function lintFindings(): Promise<{ code: number; findings: readonly LintFinding[] }> {
  const json = await phaxCall(["plans", "lint", "plan.md", "--json"]);
  const document = Result.getOrThrow(decodePlanLintFile(JSON.parse(json.out)));
  expect(document.$schema).toBe(currentSchemaUrl("plan-lint"));
  return { code: json.code, findings: document.findings };
}

const UNDEFINED_LIGHT = 'gate profile "light" is not defined in phax.json (defined: standard)';

describe("phax plans lint checks the declared gate profile", { timeout: 60_000 }, () => {
  // ac-lint-unknown
  it("reports an undefined profile as one gate-profile error listing the defined ones", async () => {
    project(["standard"], "light");

    const text = await phaxCall(["plans", "lint", "plan.md"]);

    expect(text.code).toBe(1);
    expect(text.out).toBe(
      [
        "plan.md: 1 error, 0 warnings",
        `error    gate-profile  -         ${UNDEFINED_LIGHT}`,
        "",
      ].join("\n"),
    );
    const { code, findings } = await lintFindings();
    expect(code).toBe(1);
    expect(findings).toEqual([
      { severity: "error", check: "gate-profile", phase: null, message: UNDEFINED_LIGHT },
    ]);
  });

  // ac-lint-commands
  it.each([
    {
      declared: "light" as const,
      commands: [
        'required command "pnpm test" is not covered by security.agentCommands or the gate profile',
      ],
    },
    { declared: "standard" as const, commands: [] },
  ])("judges pnpm test against $declared's steps alone", async ({ declared, commands }) => {
    project(["standard", "light"], declared, ["pnpm test"]);

    const { code, findings } = await lintFindings();

    expect(findings.filter((f) => f.check === "gate-profile")).toEqual([]);
    expect(findings.filter((f) => f.check === "commands").map((f) => f.message)).toEqual(commands);
    expect(code).toBe(commands.length > 0 ? 1 : 0);
  });

  it("skips the commands comparison when the declared profile is undefined", async () => {
    project(["standard"], "light", ["deno fmt"]);

    const { code, findings } = await lintFindings();

    expect(code).toBe(1);
    expect(findings).toEqual([
      { severity: "error", check: "gate-profile", phase: null, message: UNDEFINED_LIGHT },
    ]);
  });
});
