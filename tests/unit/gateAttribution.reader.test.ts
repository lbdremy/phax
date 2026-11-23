import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { aggregateVerifiedSurfaces } from "../../src/app/gateAttribution.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import {
  encodeGateAttributionFile,
  type GateAttribution,
} from "../../src/schemas/gateAttribution.js";
import {
  currentSchemaUrl,
  readGateAttributionFile,
  withSchemaUrl,
} from "../../src/schemas/persisted.js";
import { schemaUrl } from "../../src/schemas/schemaUrl.js";

const runPath = "/fake/runs/my-run";

const UNKNOWN = { kind: "unknown" } as const;
const NOT_RUN = { kind: "not-run" } as const;
const MEASURED = {
  kind: "measured",
  startedAt: "2026-11-23T10:00:00.000Z",
  durationMs: 1200,
} as const;

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
          time: MEASURED,
          steps: [{ command: "pnpm lint", surface: "structural", result: "pass", time: MEASURED }],
          protectedPaths: null,
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

  it("leaves acceptance off the run when a later phase skipped the step another one verified", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      `${runPath}/phase-02/gate-attribution.json`,
      JSON.stringify(
        withSchemaUrl("gate-attribution", {
          phase: "phase-02",
          time: MEASURED,
          steps: [
            { command: "pnpm test", surface: "local", result: "pass", time: MEASURED },
            {
              command: "node tools/oracles.mjs",
              surface: "acceptance",
              result: "pass",
              time: MEASURED,
            },
          ],
          protectedPaths: null,
        }),
      ),
    );
    fakeFs.impl.setFile(
      `${runPath}/phase-03/gate-attribution.json`,
      JSON.stringify(
        withSchemaUrl("gate-attribution", {
          phase: "phase-03",
          time: MEASURED,
          steps: [
            { command: "pnpm test", surface: "local", result: "pass", time: MEASURED },
            {
              command: "node tools/oracles.mjs",
              surface: "acceptance",
              result: "skipped",
              time: NOT_RUN,
            },
          ],
          protectedPaths: null,
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

describe("readGateAttributionFile", () => {
  it("round-trips a current attribution that passed and one that failed the check", () => {
    const steps = [
      { command: "pnpm test", surface: "local" as const, result: "pass" as const, time: MEASURED },
    ];
    const pass: GateAttribution = {
      phase: "phase-01",
      time: MEASURED,
      steps,
      protectedPaths: { result: "pass", changes: [], time: MEASURED },
    };
    const fail: GateAttribution = {
      phase: "phase-02",
      time: MEASURED,
      steps,
      protectedPaths: {
        result: "fail",
        changes: [{ path: "phax.json", kind: "edited", entry: "phax.json" }],
        time: MEASURED,
      },
    };
    for (const attribution of [pass, fail]) {
      const written = JSON.parse(
        JSON.stringify(encodeGateAttributionFile(withSchemaUrl("gate-attribution", attribution))),
      );
      expect(written.$schema).toBe(currentSchemaUrl("gate-attribution"));
      expect(Object.keys(written)).toEqual(["$schema", "phase", "time", "steps", "protectedPaths"]);
      expect(readGateAttributionFile("gate-attribution.json", written)).toEqual(
        Result.succeed(attribution),
      );
    }
  });

  it("refuses a failed check that lists no change", () => {
    const read = readGateAttributionFile(
      "gate-attribution.json",
      withSchemaUrl("gate-attribution", {
        phase: "phase-01",
        time: MEASURED,
        steps: [],
        protectedPaths: { result: "fail", changes: [], time: MEASURED },
      }),
    );
    expect(Result.isFailure(read)).toBe(true);
  });

  it("refuses a current-stamp attribution whose step has no time, naming the time field", () => {
    const read = readGateAttributionFile(
      "phase-01/gate-attribution.json",
      withSchemaUrl("gate-attribution", {
        phase: "phase-01",
        time: MEASURED,
        steps: [{ command: "pnpm test", surface: "local", result: "pass" }],
        protectedPaths: null,
      }),
    );
    expect(Result.isFailure(read)).toBe(true);
    if (Result.isFailure(read)) {
      expect(read.failure.message).toContain("phase-01/gate-attribution.json");
      expect(read.failure.message).toMatch(/\btime\b/);
    }
  });

  it("refuses a skipped acceptance step with a measured time and a run one with not-run", () => {
    const configured = { command: "pnpm test", surface: "local", result: "pass", time: MEASURED };
    const refusedSteps = [
      { command: "node oracles.mjs", surface: "acceptance", result: "skipped", time: MEASURED },
      { command: "node oracles.mjs", surface: "acceptance", result: "pass", time: NOT_RUN },
      { command: "node oracles.mjs", surface: "acceptance", result: "fail", time: NOT_RUN },
      { command: "pnpm lint", surface: "local", result: "pass", time: NOT_RUN },
    ];
    for (const step of refusedSteps) {
      const read = readGateAttributionFile(
        "gate-attribution.json",
        withSchemaUrl("gate-attribution", {
          phase: "phase-01",
          time: MEASURED,
          steps: [configured, step],
          protectedPaths: null,
        }),
      );
      expect(Result.isFailure(read), JSON.stringify(step)).toBe(true);
    }
  });

  it("reads a 0.33.0 attribution with its times unknown and a skipped acceptance step not-run", () => {
    const read = readGateAttributionFile("phase-02/gate-attribution.json", {
      $schema: schemaUrl("gate-attribution", "0.33.0"),
      phase: "phase-02",
      steps: [
        { command: "pnpm test", surface: "local", result: "pass" },
        { command: "node oracles.mjs", surface: "acceptance", result: "skipped" },
      ],
      protectedPaths: { result: "pass", changes: [] },
    });
    expect(read).toEqual(
      Result.succeed({
        phase: "phase-02",
        time: UNKNOWN,
        steps: [
          { command: "pnpm test", surface: "local", result: "pass", time: UNKNOWN },
          { command: "node oracles.mjs", surface: "acceptance", result: "skipped", time: NOT_RUN },
        ],
        protectedPaths: { result: "pass", changes: [], time: UNKNOWN },
      }),
    );
  });

  const change = { path: "phax.json", kind: "edited", entry: "phax.json" };
  const olderStamps: ReadonlyArray<{
    readonly stamp: string;
    readonly document: Record<string, unknown>;
    readonly expected: GateAttribution;
  }> = [
    {
      stamp: "pre-schema",
      document: {
        phase: "phase-01",
        steps: [
          { command: "pnpm test", surface: "local", result: "pass" },
          { command: "pnpm build", surface: "product", result: "fail" },
        ],
      },
      expected: {
        phase: "phase-01",
        time: UNKNOWN,
        steps: [
          { command: "pnpm test", surface: "local", result: "pass", time: UNKNOWN },
          { command: "pnpm build", surface: "product", result: "fail", time: UNKNOWN },
        ],
        protectedPaths: null,
      },
    },
    ...["0.17.0", "0.20.0"].map((release) => ({
      stamp: release,
      document: {
        $schema: schemaUrl("gate-attribution", release),
        phase: "phase-01",
        steps: [{ command: "pnpm test", surface: "local", result: "pass" }],
      },
      expected: {
        phase: "phase-01",
        time: UNKNOWN,
        steps: [{ command: "pnpm test", surface: "local", result: "pass", time: UNKNOWN }],
        protectedPaths: null,
      } satisfies GateAttribution,
    })),
    {
      stamp: "0.21.0",
      document: {
        $schema: schemaUrl("gate-attribution", "0.21.0"),
        phase: "phase-01",
        steps: [
          { command: "pnpm test", surface: "local", result: "pass" },
          { command: "node ./audit.mjs", surface: "structural", result: "refused" },
        ],
      },
      expected: {
        phase: "phase-01",
        time: UNKNOWN,
        steps: [
          { command: "pnpm test", surface: "local", result: "pass", time: UNKNOWN },
          { command: "node ./audit.mjs", surface: "structural", result: "refused", time: UNKNOWN },
        ],
        protectedPaths: null,
      },
    },
    {
      stamp: "0.26.0",
      document: {
        $schema: schemaUrl("gate-attribution", "0.26.0"),
        phase: "phase-02",
        steps: [
          { command: "pnpm test", surface: "local", result: "pass" },
          { command: "node oracles.mjs", surface: "oracle", result: "skipped" },
        ],
      },
      expected: {
        phase: "phase-02",
        time: UNKNOWN,
        steps: [
          { command: "pnpm test", surface: "local", result: "pass", time: UNKNOWN },
          { command: "node oracles.mjs", surface: "acceptance", result: "skipped", time: NOT_RUN },
        ],
        protectedPaths: null,
      },
    },
    {
      stamp: "0.31.0",
      document: {
        $schema: schemaUrl("gate-attribution", "0.31.0"),
        phase: "phase-02",
        steps: [
          { command: "pnpm test", surface: "local", result: "pass" },
          { command: "node oracles.mjs", surface: "oracle", result: "pass" },
        ],
        protectedPaths: { result: "pass", changes: [] },
      },
      expected: {
        phase: "phase-02",
        time: UNKNOWN,
        steps: [
          { command: "pnpm test", surface: "local", result: "pass", time: UNKNOWN },
          { command: "node oracles.mjs", surface: "acceptance", result: "pass", time: UNKNOWN },
        ],
        protectedPaths: { result: "pass", changes: [], time: UNKNOWN },
      },
    },
    {
      stamp: "0.33.0",
      document: {
        $schema: schemaUrl("gate-attribution", "0.33.0"),
        phase: "phase-02",
        steps: [
          { command: "pnpm test", surface: "local", result: "pass" },
          { command: "node oracles.mjs", surface: "acceptance", result: "skipped" },
        ],
        protectedPaths: { result: "fail", changes: [change] },
      },
      expected: {
        phase: "phase-02",
        time: UNKNOWN,
        steps: [
          { command: "pnpm test", surface: "local", result: "pass", time: UNKNOWN },
          { command: "node oracles.mjs", surface: "acceptance", result: "skipped", time: NOT_RUN },
        ],
        protectedPaths: {
          result: "fail",
          changes: [{ path: "phax.json", kind: "edited", entry: "phax.json" }],
          time: UNKNOWN,
        },
      },
    },
  ];

  it.each(olderStamps)(
    "reads a $stamp attribution with every time unknown, a skipped acceptance step not-run",
    ({ document, expected }) => {
      expect(readGateAttributionFile("gate-attribution.json", document)).toEqual(
        Result.succeed(expected),
      );
    },
  );
});
