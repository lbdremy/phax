import { Effect, Either } from "effect";
import { describe, expect, it } from "vitest";
import { aggregateVerifiedSurfaces } from "../../src/app/gateAttribution.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  encodeGateAttributionFile,
  type GateAttribution,
} from "../../src/schemas/gateAttribution.js";
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
          protectedPaths: null,
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

  it("reads a 0.20.0-, 0.21.0- and 0.26.0-stamped attribution with protectedPaths null", () => {
    const steps = [
      { command: "pnpm test", surface: "local", result: "pass" },
      { command: "node ./audit.mjs", surface: "structural", result: "refused" },
    ];
    for (const release of ["0.20.0", "0.21.0", "0.26.0"]) {
      const read = readGateAttributionFile("phase-01/gate-attribution.json", {
        $schema: schemaUrl("gate-attribution", release),
        phase: "phase-01",
        steps,
      });
      expect(read).toEqual(Either.right({ phase: "phase-01", steps, protectedPaths: null }));
    }
  });

  it("reads a pre-schema attribution with protectedPaths null", () => {
    const steps = [{ command: "pnpm test", surface: "local", result: "pass" }];
    const read = readGateAttributionFile("phase-01/gate-attribution.json", {
      phase: "phase-01",
      steps,
    });
    expect(read).toEqual(Either.right({ phase: "phase-01", steps, protectedPaths: null }));
  });

  it("round-trips a 0.31.0 attribution that passed and one that failed the check", () => {
    const steps = [{ command: "pnpm test", surface: "local" as const, result: "pass" as const }];
    const pass: GateAttribution = {
      phase: "phase-01",
      steps,
      protectedPaths: { result: "pass", changes: [] },
    };
    const fail: GateAttribution = {
      phase: "phase-02",
      steps,
      protectedPaths: {
        result: "fail",
        changes: [{ path: "phax.json", kind: "edited", entry: "phax.json" }],
      },
    };
    for (const attribution of [pass, fail]) {
      const written = JSON.parse(
        JSON.stringify(encodeGateAttributionFile(withSchemaUrl("gate-attribution", attribution))),
      );
      expect(written.$schema).toBe(schemaUrl("gate-attribution", "0.31.0"));
      expect(readGateAttributionFile("gate-attribution.json", written)).toEqual(
        Either.right(attribution),
      );
    }
  });

  it("refuses a failed check that lists no change", () => {
    const read = readGateAttributionFile(
      "gate-attribution.json",
      withSchemaUrl("gate-attribution", {
        phase: "phase-01",
        steps: [],
        protectedPaths: { result: "fail", changes: [] },
      }),
    );
    expect(Either.isLeft(read)).toBe(true);
  });

  it("leaves oracle off the run when a later phase skipped the oracle another one verified", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      `${runPath}/phase-02/gate-attribution.json`,
      JSON.stringify(
        withSchemaUrl("gate-attribution", {
          phase: "phase-02",
          protectedPaths: null,
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
          protectedPaths: null,
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
