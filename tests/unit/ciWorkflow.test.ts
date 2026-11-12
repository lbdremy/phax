import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
