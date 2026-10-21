import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { aggregateVerifiedSurfaces } from "../../src/app/gateAttribution.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { readGateAttributionFile, withSchemaUrl } from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

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

  it("reads an attribution phax writes ($schema) beside one recorded before $schema", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      `${runPath}/phase-01/gate-attribution.json`,
      JSON.stringify(
        withSchemaUrl("gate-attribution", {
          phase: "phase-01",
          steps: [{ command: "pnpm lint", surface: "structural", result: "pass" }],
        }),
      ),
    );
    // Pre-schema: no $schema and no version, as 0.16.0 wrote it.
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

    expect(result).toEqual(["product", "structural"]);
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

  it("reads a 0.20.0- and a 0.21.0-stamped attribution through the current decoder", () => {
    const steps = [
      { command: "pnpm test", surface: "local", result: "pass" },
      { command: "node ./audit.mjs", surface: "structural", result: "refused" },
    ];
    for (const release of ["0.20.0", "0.21.0"]) {
      const read = readGateAttributionFile("phase-01/gate-attribution.json", {
        $schema: schemaUrl("gate-attribution", release),
        phase: "phase-01",
        steps,
      });
      expect(Either.isRight(read) ? read.right.steps : null).toEqual(steps);
    }
  });

  it("leaves oracle off the run when a later phase skipped the oracle another one verified", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      `${runPath}/phase-02/gate-attribution.json`,
      JSON.stringify(
        withSchemaUrl("gate-attribution", {
          phase: "phase-02",
          steps: [
            { command: "pnpm test", surface: "local", result: "pass" },
            { command: "node tools/oracles.mjs", surface: "oracle", result: "pass" },
          ],
        }),
      ),
    );
    fakeFs.impl.setFile(
      `${runPath}/phase-03/gate-attribution.json`,
      JSON.stringify(
        withSchemaUrl("gate-attribution", {
          phase: "phase-03",
          steps: [
            { command: "pnpm test", surface: "local", result: "pass" },
            { command: "node tools/oracles.mjs", surface: "oracle", result: "skipped" },
          ],
        }),
      ),
    );

    const result = await Effect.runPromise(
      aggregateVerifiedSurfaces(runPath, ["phase-02", "phase-03"]).pipe(
        Effect.provide(fakeFs.layer),
      ),
    );

    expect(result).toEqual(["local"]);
  });

  it("returns an empty set for no phases", async () => {
    const fakeFs = makeFakeFileSystem();

    const result = await Effect.runPromise(
      aggregateVerifiedSurfaces(runPath, []).pipe(Effect.provide(fakeFs.layer)),
    );

    expect(result).toEqual([]);
  });
});
