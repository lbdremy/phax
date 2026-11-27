import { tmpdir, userInfo } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isolatePhaxHome, phaxHomeEnv } from "../helpers/isolatePhaxHome.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// A PHAX_HOME a test sets on purpose, put back to absent after each test.
function setPhaxHome(value: string): void {
  process.env["PHAX_HOME"] = value;
}

afterEach(() => {
  delete process.env["PHAX_HOME"];
});

describe("an exported PHAX_HOME", () => {
  it("is gone from the test process when a test body runs", () => {
    expect(process.env["PHAX_HOME"]).toBeUndefined();
    expect(Object.hasOwn(process.env, "PHAX_HOME")).toBe(false);
  });
});

describe("phaxHomeEnv() without a per-test home", () => {
  it("carries no PHAX_HOME, and HOME is a temporary spawn home", () => {
    const env = phaxHomeEnv();
    expect(Object.hasOwn(env, "PHAX_HOME")).toBe(false);
    expect(env["HOME"]).toMatch(/phax-spawn-home-/);
    expect(env["HOME"]).not.toBe(userInfo().homedir);
  });

  it("carries no PHAX_HOME even after a test set process.env.PHAX_HOME", () => {
    setPhaxHome(`${tmpdir()}/phax-set-by-test`);
    const env = phaxHomeEnv();
    expect(Object.hasOwn(env, "PHAX_HOME")).toBe(false);
    expect(process.env["PHAX_HOME"]).toBe(`${tmpdir()}/phax-set-by-test`);
  });
});

describe("phaxHomeEnv() with a per-test home", () => {
  let isolation: ReturnType<typeof isolatePhaxHome>;

  beforeEach(() => {
    isolation = isolatePhaxHome();
  });

  afterEach(() => {
    isolation.restore();
  });

  it("carries no PHAX_HOME, and HOME is the per-test home", () => {
    const env = phaxHomeEnv();
    expect(Object.hasOwn(env, "PHAX_HOME")).toBe(false);
    expect(env["HOME"]).toBe(isolation.home);
  });

  it("carries no PHAX_HOME even after a test set process.env.PHAX_HOME", () => {
    setPhaxHome(`${isolation.home}/moved-phax`);
    const env = phaxHomeEnv();
    expect(Object.hasOwn(env, "PHAX_HOME")).toBe(false);
    expect(env["HOME"]).toBe(isolation.home);
  });

  it("keeps the rest of process.env", () => {
    expect(phaxHomeEnv()["PATH"]).toBe(process.env["PATH"]);
  });
});
