import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { aggregateVerifiedSurfaces } from "../../src/app/gateAttribution.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";

const runPath = "/fake/runs/my-run";

describe("aggregateVerifiedSurfaces", () => {
  it("unions verified surfaces across phases", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      `${runPath}/phase-01/gate-attribution.json`,
      JSON.stringify({
        phase: "phase-01",
        steps: [{ command: "pnpm format", surface: "local", result: "pass" }],
      }),
    );
    fakeFs.impl.setFile(
      `${runPath}/phase-02/gate-attribution.json`,
      JSON.stringify({
        phase: "phase-02",
        steps: [{ command: "pnpm build", surface: "product", result: "pass" }],
      }),
    );

    const result = await Effect.runPromise(
      aggregateVerifiedSurfaces(runPath, ["phase-01", "phase-02"]).pipe(
        Effect.provide(fakeFs.layer),
      ),
    );

    expect(result).toEqual(["local", "product"]);
  });

  it("skips phases with a missing attribution file", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      `${runPath}/phase-01/gate-attribution.json`,
      JSON.stringify({
        phase: "phase-01",
        steps: [{ command: "pnpm format", surface: "local", result: "pass" }],
      }),
    );

    const result = await Effect.runPromise(
      aggregateVerifiedSurfaces(runPath, ["phase-01", "phase-02"]).pipe(
        Effect.provide(fakeFs.layer),
      ),
    );

    expect(result).toEqual(["local"]);
  });

  it("skips phases with an undecodable attribution file", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(`${runPath}/phase-01/gate-attribution.json`, "not json");

    const result = await Effect.runPromise(
      aggregateVerifiedSurfaces(runPath, ["phase-01"]).pipe(Effect.provide(fakeFs.layer)),
    );

    expect(result).toEqual([]);
  });

  it("returns an empty set for no phases", async () => {
    const fakeFs = makeFakeFileSystem();

    const result = await Effect.runPromise(
      aggregateVerifiedSurfaces(runPath, []).pipe(Effect.provide(fakeFs.layer)),
    );

    expect(result).toEqual([]);
  });
});
