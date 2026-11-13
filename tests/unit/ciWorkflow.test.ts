import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflowPath = join(import.meta.dirname, "../../.github/workflows/ci.yml");
const workflow = readFileSync(workflowPath, "utf-8");

describe("CI workflow invariants", () => {
  it("triggers on pull_request", () => {
    expect(workflow).toContain("pull_request");
  });

  it("triggers on push", () => {
    expect(workflow).toContain("push");
  });

  it("sets up Deno, Node and usage through mise, not their own setup steps", () => {
    expect(workflow).toContain("jdx/mise-action@");
    expect(workflow).not.toContain("denoland/setup-deno");
    expect(workflow).not.toContain("actions/setup-node");
    expect(readFileSync(join(import.meta.dirname, "../../mise.toml"), "utf-8")).toMatch(
      /^deno = /m,
    );
  });

  it("runs pnpm typecheck", () => {
    expect(workflow).toContain("pnpm typecheck");
  });

  it("runs pnpm test", () => {
    expect(workflow).toContain("pnpm test");
  });

  it("runs pnpm lint", () => {
    expect(workflow).toContain("pnpm lint");
  });

  it("runs pnpm format:check", () => {
    expect(workflow).toContain("pnpm format:check");
  });

  it("runs pnpm knip", () => {
    expect(workflow).toContain("pnpm knip");
  });

  it("runs pnpm build", () => {
    expect(workflow).toContain("pnpm build");
  });

  it("runs pnpm audit:architecture", () => {
    expect(workflow).toContain("pnpm audit:architecture");
  });

  it("runs pnpm deno:smoke", () => {
    expect(workflow).toContain("pnpm deno:smoke");
  });

  it("runs pnpm deno:compile", () => {
    expect(workflow).toContain("pnpm deno:compile");
  });
});

// GitHub substitutes `${{ … }}` into a step's script text before the shell
// reads it, so a value carrying shell syntax (a tag name, a step output) would
// run as code. A step hands such values to its script through `env:` and the
// script quotes the variable.
describe("Workflows: no expression inside a run script", () => {
  const dir = join(import.meta.dirname, "../../.github/workflows");
  const files = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f));

  it.each(files)("%s substitutes nothing into a run script", (file) => {
    const doc = parse(readFileSync(join(dir, file), "utf-8")) as {
      readonly jobs: Readonly<
        Record<string, { readonly steps?: readonly { readonly run?: string }[] }>
      >;
    };
    const offending = Object.entries(doc.jobs).flatMap(([job, { steps = [] }]) =>
      steps.filter((s) => s.run?.includes("${{")).map((s) => `${job}: ${s.run}`),
    );
    expect(offending).toEqual([]);
  });
});

describe("Security workflow", () => {
  const securityPath = join(import.meta.dirname, "../../.github/workflows/security.yml");
  const security = parse(readFileSync(securityPath, "utf-8")) as {
    readonly on: Readonly<Record<string, unknown>>;
    readonly permissions: unknown;
    readonly jobs: Readonly<
      Record<
        string,
        {
          readonly container?: { readonly image: string };
          readonly steps: readonly {
            readonly uses?: string;
            readonly run?: string;
            readonly env?: Readonly<Record<string, string>>;
          }[];
        }
      >
    >;
  };

  it("runs on pull requests, on main, daily and on demand, reading the repository only", () => {
    expect(Object.keys(security.on).toSorted()).toEqual(
      ["pull_request", "push", "schedule", "workflow_dispatch"].toSorted(),
    );
    expect(security.permissions).toEqual({ contents: "read" });
  });

  it("holds the security audit, which CI no longer runs", () => {
    expect(Object.keys(security.jobs)).toContain("security-audit");
    expect(
      security.jobs["security-audit"]!.steps.some((s) => s.run === "pnpm audit:security"),
    ).toBe(true);
    expect(workflow).not.toContain("security-audit");
  });

  it("runs semgrep ci from an image pinned by digest, the token from the secrets", () => {
    const semgrep = security.jobs["semgrep"]!;
    expect(semgrep.container?.image).toMatch(/^semgrep\/semgrep:[\d.]+@sha256:[0-9a-f]{64}$/);
    const scan = semgrep.steps.find((s) => s.run?.includes("semgrep ci"))!;
    expect(scan.env?.["SEMGREP_APP_TOKEN"]).toBe("${{ secrets.SEMGREP_APP_TOKEN }}");
    // A fork's pull request has no token: public rules, with telemetry off.
    expect(scan.run).toContain("--metrics=off");
  });
});
