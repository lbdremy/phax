import { Effect, Layer } from "effect";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readVerifiedSurfaces } from "../../src/app/gateAttribution.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import type { GateAttribution } from "../../src/schemas/gateAttribution.js";
import { encodeGateAttribution } from "../../src/schemas/gateAttribution.js";

const RUN_PATH = "/fake-state/runs/my-run";

function makeAttribution(phase: string, steps: GateAttribution["steps"]): string {
  return JSON.stringify(encodeGateAttribution({ phase, steps }));
}

function runReader(
  runPath: string,
  phaseIds: string[],
  fs: ReturnType<typeof makeFakeFileSystem>,
): Promise<readonly string[]> {
  return Effect.runPromise(readVerifiedSurfaces(runPath, phaseIds).pipe(Effect.provide(fs.layer)));
}

describe("readVerifiedSurfaces", () => {
  it("returns empty array when no phase ids are provided", async () => {
    const fs = makeFakeFileSystem();
    const result = await runReader(RUN_PATH, [], fs);
    expect(result).toEqual([]);
  });

  it("returns empty array when no attribution files exist", async () => {
    const fs = makeFakeFileSystem();
    const result = await runReader(RUN_PATH, ["phase-01", "phase-02"], fs);
    expect(result).toEqual([]);
  });

  it("skips missing attribution files without error", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttribution("phase-01", [{ command: "pnpm test", surface: "local", result: "pass" }]),
    );
    // phase-02 file is absent
    const result = await runReader(RUN_PATH, ["phase-01", "phase-02"], fs);
    expect(result).toEqual(["local"]);
  });

  it("returns surfaces that have at least one passing step", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttribution("phase-01", [
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm build", surface: "product", result: "pass" },
      ]),
    );
    const result = await runReader(RUN_PATH, ["phase-01"], fs);
    expect(result).toEqual(["local", "product"]);
  });

  it("does not include surfaces where all steps failed", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttribution("phase-01", [
        { command: "pnpm test", surface: "local", result: "fail" },
        { command: "pnpm build", surface: "product", result: "pass" },
      ]),
    );
    const result = await runReader(RUN_PATH, ["phase-01"], fs);
    // local has only fail, product has pass
    expect(result).toEqual(["product"]);
  });

  it("deduplicates surfaces across phases", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttribution("phase-01", [{ command: "pnpm test", surface: "local", result: "pass" }]),
    );
    fs.impl.setFile(
      join(RUN_PATH, "phase-02", "gate-attribution.json"),
      makeAttribution("phase-02", [{ command: "pnpm lint", surface: "local", result: "pass" }]),
    );
    const result = await runReader(RUN_PATH, ["phase-01", "phase-02"], fs);
    expect(result).toEqual(["local"]);
  });

  it("aggregates surfaces across phases", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttribution("phase-01", [{ command: "pnpm test", surface: "local", result: "pass" }]),
    );
    fs.impl.setFile(
      join(RUN_PATH, "phase-02", "gate-attribution.json"),
      makeAttribution("phase-02", [
        { command: "pnpm build", surface: "product", result: "pass" },
        { command: "pnpm knip", surface: "structural", result: "pass" },
      ]),
    );
    const result = await runReader(RUN_PATH, ["phase-01", "phase-02"], fs);
    expect(result).toEqual(["local", "product", "structural"]);
  });

  it("returns surfaces sorted alphabetically", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      makeAttribution("phase-01", [
        { command: "pnpm build", surface: "product", result: "pass" },
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "pnpm knip", surface: "structural", result: "pass" },
      ]),
    );
    const result = await runReader(RUN_PATH, ["phase-01"], fs);
    expect(result).toEqual(["local", "product", "structural"]);
  });

  it("skips files with invalid JSON without error", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(join(RUN_PATH, "phase-01", "gate-attribution.json"), "not valid json");
    fs.impl.setFile(
      join(RUN_PATH, "phase-02", "gate-attribution.json"),
      makeAttribution("phase-02", [{ command: "pnpm test", surface: "local", result: "pass" }]),
    );
    const result = await runReader(RUN_PATH, ["phase-01", "phase-02"], fs);
    expect(result).toEqual(["local"]);
  });

  it("skips files that do not match the attribution schema without error", async () => {
    const fs = makeFakeFileSystem();
    fs.impl.setFile(
      join(RUN_PATH, "phase-01", "gate-attribution.json"),
      JSON.stringify({ unexpected: "shape" }),
    );
    fs.impl.setFile(
      join(RUN_PATH, "phase-02", "gate-attribution.json"),
      makeAttribution("phase-02", [{ command: "pnpm test", surface: "local", result: "pass" }]),
    );
    const result = await runReader(RUN_PATH, ["phase-01", "phase-02"], fs);
    expect(result).toEqual(["local"]);
  });
});
