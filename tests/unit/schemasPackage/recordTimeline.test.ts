import { Result, type Schema } from "effect";
import { describe, expect, it } from "vitest";
import { CURRENT_SHAPES, PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseDocument,
  parseGateAttribution,
  parseGateRequest,
  parsePhaseFileReconciliation,
  parseRecordManifest,
  toLatestGateAttribution,
  toLatestGateRequest,
  toLatestPhaseFileReconciliation,
} from "../../../packages/schemas/src/index.js";
import { missingSchemaMessage, newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeGateAttributionFile } from "../../../src/schemas/gateAttribution.js";
import { decodeGateRequestFile } from "../../../src/schemas/gateRequest.js";
import { currentSchemaUrl, readGateAttributionFile } from "../../../src/schemas/persisted.js";
import { CURRENT_STAMPS } from "../../../src/schemas/release.js";
import { decodePhaseFileReconciliationFile } from "../../../src/schemas/reconciliation.js";
import {
  schemaUrl,
  type FormatId,
  type PreSchemaFormatId,
} from "../../../src/schemas/schemaUrl.js";
import {
  belowOwnReleaseMessage,
  latestPreSchema,
  phaxLatestPreSchema,
  preSchemaDocuments,
  validDocuments,
  withKey,
  withoutKey,
  type Doc,
} from "./documents.js";

type Decode = (input: unknown) => Result.Result<unknown, Schema.SchemaError>;
type Parse = (input: unknown) => {
  readonly ok: boolean;
  readonly shape?: string;
  readonly value?: unknown;
};

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

interface TimelineFormat {
  readonly id: PreSchemaFormatId;
  readonly parse: Parse;
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
}

const FORMATS: ReadonlyArray<TimelineFormat> = [
  {
    id: "gate-attribution",
    parse: parseGateAttribution,
    phax: decodeGateAttributionFile,
    toLatest: toLatestGateAttribution,
  },
  {
    id: "phase-file-reconciliation",
    parse: parsePhaseFileReconciliation,
    phax: decodePhaseFileReconciliationFile,
    toLatest: toLatestPhaseFileReconciliation,
  },
];

describe.each(FORMATS)("$id", (format) => {
  const preSchema = preSchemaDocuments[format.id];
  const written = validDocuments[format.id];

  it("parses a document without $schema as shape pre-schema", () => {
    expect(format.parse(preSchema)).toEqual({ ok: true, shape: "pre-schema", value: preSchema });
  });

  it("reads a pre-schema document carrying a version key as pre-schema", () => {
    const versioned = withKey(preSchema, "version", 0);
    expect(format.parse(versioned)).toMatchObject({ ok: true, shape: "pre-schema" });
  });

  it("parses a phax-written document as its current shape, with phax's value", () => {
    expect(Object.keys(written)[0]).toBe("$schema");
    expect(written).not.toHaveProperty("version");
    const phax = format.phax(written);
    if (Result.isFailure(phax)) throw new Error("document rejected by phax");
    expect(format.parse(written)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES[format.id],
      value: phax.success,
    });
  });

  it("upgrades either shape to the same value: the identity on pre-schema, without $schema on the current shape", () => {
    const pre = format.parse(preSchema);
    const current = format.parse(written);
    if (!pre.ok || !current.ok) throw new Error("document rejected");
    // A pre-schema document is its own latest value, but for the facts a later
    // shape added: a reconciliation written before `reviewCorrections` gets [].
    // A gate attribution written today also records `protectedPaths` and its
    // times: the sample's are `unknown`, as phax lifts the pre-schema one.
    expect(format.toLatest(pre.value as never)).toEqual(latestPreSchema(format.id));
    expect(format.toLatest(current.value as never)).toEqual(
      format.id === "gate-attribution"
        ? phaxLatestPreSchema("gate-attribution")
        : latestPreSchema(format.id),
    );
    expect(format.toLatest(current.value as never)).not.toHaveProperty("$schema");
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(written, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });

  it("reads no shape below the package's own release", () => {
    const older = withKey(written, "$schema", schemaUrl(format.id, "0.1.0"));
    expect(format.parse(older)).toEqual({
      ok: false,
      error: { path: "$schema", message: belowOwnReleaseMessage(format.id, "0.1.0") },
    });
  });
});

const UNKNOWN_TIME = { kind: "unknown" } as const;
const NOT_RUN = { kind: "not-run" } as const;
const MEASURED_TIME = {
  kind: "measured",
  startedAt: "2026-11-23T10:00:00.000Z",
  durationMs: 1200,
} as const;

// gate-attribution gained `refused` after 0.20.0: each stamp reads as the shape
// its release wrote.
function attributionSteps(result: string) {
  return [{ command: "node ./audit.mjs", surface: "structural", result }];
}

function attributionStampedAt(release: string, result: string) {
  return {
    $schema: schemaUrl("gate-attribution", release),
    phase: "phase-01",
    steps: attributionSteps(result),
  };
}

describe("gate-attribution's released shapes", () => {
  const stampedAt = attributionStampedAt;

  it("reads a 0.20.0 attribution as shape 0.20.0", () => {
    const document = stampedAt("0.20.0", "fail");
    const parsed = parseGateAttribution(document);
    expect(parsed).toEqual({ ok: true, shape: "0.20.0", value: document });
    if (!parsed.ok || parsed.shape !== "0.20.0") return;
    expect(toLatestGateAttribution(parsed.value)).toEqual({
      phase: "phase-01",
      steps: attributionSteps("fail"),
    });
  });

  it("refuses refused in a 0.20.0 attribution", () => {
    expect(parseGateAttribution(stampedAt("0.20.0", "refused"))).toMatchObject({ ok: false });
  });

  it("reads a 0.26.0 attribution as shape 0.26.0, an oracle step included, and lifts it to the latest", () => {
    const document = {
      ...stampedAt("0.26.0", "refused"),
      steps: [
        ...attributionSteps("refused"),
        { command: "oracles provider", surface: "oracle", result: "skipped" },
      ],
    };
    const parsed = parseGateAttribution(document);
    expect(parsed).toEqual({ ok: true, shape: "0.26.0", value: document });
    if (!parsed.ok || parsed.shape !== "0.26.0") return;
    // The oracle step's surface is lifted to acceptance, a 0.26.0 attribution
    // ran no protected-paths check, and it recorded no time.
    expect(toLatestGateAttribution(parsed.value)).toEqual({
      phase: document.phase,
      time: UNKNOWN_TIME,
      steps: [
        {
          command: "node ./audit.mjs",
          surface: "structural",
          result: "refused",
          time: UNKNOWN_TIME,
        },
        {
          command: "oracles provider",
          surface: "acceptance",
          result: "skipped",
          time: { kind: "not-run" },
        },
      ],
      protectedPaths: null,
    });
  });

  it("refuses an attribution at the current stamp without protectedPaths", () => {
    expect(
      parseGateAttribution({
        ...stampedAt(CURRENT_STAMPS["gate-attribution"], "refused"),
        time: MEASURED_TIME,
      }),
    ).toMatchObject({ ok: false });
  });

  it("refuses an attribution at the current stamp without its time", () => {
    expect(
      parseGateAttribution({
        ...stampedAt(CURRENT_STAMPS["gate-attribution"], "refused"),
        protectedPaths: null,
      }),
    ).toMatchObject({ ok: false, error: { path: "time" } });
  });

  it("reads an attribution at the current stamp, refused included, as the current shape", () => {
    const document = {
      $schema: currentSchemaUrl("gate-attribution"),
      phase: "phase-01",
      time: MEASURED_TIME,
      steps: [
        {
          command: "node ./audit.mjs",
          surface: "structural",
          result: "refused",
          time: MEASURED_TIME,
        },
      ],
      protectedPaths: null,
    };
    expect(parseGateAttribution(document)).toEqual({
      ok: true,
      shape: CURRENT_SHAPES["gate-attribution"],
      value: document,
    });
  });
});

// ac-package: the package and phax's reader agree on a timed attribution and
// on one stamped before times, through the one shared lift.
describe("gate-attribution times in the package", () => {
  const timed = {
    $schema: currentSchemaUrl("gate-attribution"),
    phase: "phase-02",
    time: MEASURED_TIME,
    steps: [
      { command: "pnpm test", surface: "local", result: "pass", time: MEASURED_TIME },
      { command: "node oracles.mjs", surface: "acceptance", result: "skipped", time: NOT_RUN },
    ],
    protectedPaths: { result: "pass", changes: [], time: MEASURED_TIME },
  };
  const untimed = {
    $schema: schemaUrl("gate-attribution", "0.31.0"),
    phase: "phase-02",
    steps: [
      { command: "pnpm test", surface: "local", result: "pass" },
      { command: "node oracles.mjs", surface: "oracle", result: "pass" },
    ],
    protectedPaths: {
      result: "fail",
      changes: [{ path: "phax.json", kind: "edited", entry: "phax.json" }],
    },
  };

  it.each([
    ["the current stamp, its times measured", timed],
    ["0.31.0, its times unknown", untimed],
  ])("lifts an attribution stamped %s as phax's reader reads it", (_label, document) => {
    const parsed = parseGateAttribution(document);
    if (!parsed.ok) throw new Error(`refused: ${parsed.error.message}`);
    const phax = readGateAttributionFile("gate-attribution.json", document);
    if (Result.isFailure(phax)) throw new Error(phax.failure.message);
    expect(toLatestGateAttribution(parsed.value)).toEqual(phax.success);
  });

  it("gives the current stamp's measured times and 0.31.0's unknown times", () => {
    const fromTimed = parseGateAttribution(timed);
    const fromUntimed = parseGateAttribution(untimed);
    if (!fromTimed.ok || !fromUntimed.ok) throw new Error("refused");
    expect(toLatestGateAttribution(fromTimed.value)).toMatchObject({
      time: MEASURED_TIME,
      steps: [{ time: MEASURED_TIME }, { time: NOT_RUN }],
      protectedPaths: { time: MEASURED_TIME },
    });
    expect(toLatestGateAttribution(fromUntimed.value)).toMatchObject({
      time: UNKNOWN_TIME,
      steps: [{ time: UNKNOWN_TIME }, { surface: "acceptance", time: UNKNOWN_TIME }],
      protectedPaths: { time: UNKNOWN_TIME },
    });
  });

  it("reads a 0.33.0 attribution as shape 0.33.0 and lifts it with unknown times", () => {
    const document = {
      $schema: schemaUrl("gate-attribution", "0.33.0"),
      phase: "phase-02",
      steps: [{ command: "node oracles.mjs", surface: "acceptance", result: "skipped" }],
      protectedPaths: null,
    };
    const parsed = parseGateAttribution(document);
    expect(parsed).toEqual({ ok: true, shape: "0.33.0", value: document });
    if (!parsed.ok || parsed.shape !== "0.33.0") return;
    expect(toLatestGateAttribution(parsed.value)).toEqual({
      phase: "phase-02",
      time: UNKNOWN_TIME,
      steps: [
        { command: "node oracles.mjs", surface: "acceptance", result: "skipped", time: NOT_RUN },
      ],
      protectedPaths: null,
    });
  });
});

// The acceptance criterion: a record's timeline files parse. The same folder
// is written twice, its files listed out of order: by hand in the pre-schema
// shapes, and as phax writes it today.
type Folder = { readonly [name: string]: Doc };

function folder(documents: { readonly [F in PreSchemaFormatId]: Doc }): Folder {
  return {
    "record.json": documents["phase-record-manifest"],
    "file-reconciliation.json": documents["phase-file-reconciliation"],
    "gate-attribution.json": documents["gate-attribution"],
  };
}

const RECORD_FOLDERS: ReadonlyArray<{
  readonly written: string;
  readonly shapes: string;
  readonly shape: (id: FormatId) => string;
  readonly files: Folder;
}> = [
  {
    written: "by hand in the pre-schema shapes",
    shapes: "pre-schema",
    shape: () => "pre-schema",
    files: folder(preSchemaDocuments),
  },
  {
    written: "by phax",
    shapes: "their current shapes",
    shape: (id) => CURRENT_SHAPES[id],
    files: folder(validDocuments),
  },
];

describe.each(RECORD_FOLDERS)(
  "a record's timeline files written $written",
  ({ shapes, shape, files }) => {
    const contents: ReadonlyMap<string, string> = new Map(
      Object.entries(files).map(([name, document]) => [
        name,
        `${JSON.stringify(document, null, 2)}\n`,
      ]),
    );

    function read(name: string): unknown {
      const content = contents.get(name);
      if (content === undefined) throw new Error(`no ${name} in the record folder`);
      return JSON.parse(content);
    }

    it(`parse, each with its own function, as ${shapes}`, () => {
      const record = parseRecordManifest(read("record.json"));
      expect(record).toMatchObject({
        ok: true,
        format: "phase-record-manifest",
        shape: shape("phase-record-manifest"),
      });

      const attribution = parseGateAttribution(read("gate-attribution.json"));
      const reconciliation = parsePhaseFileReconciliation(read("file-reconciliation.json"));
      expect(attribution).toMatchObject({ ok: true, shape: shape("gate-attribution") });
      expect(reconciliation).toMatchObject({
        ok: true,
        shape: shape("phase-file-reconciliation"),
      });
      if (!record.ok || record.format !== "phase-record-manifest") return;
      if (!attribution.ok || !reconciliation.ok) return;

      // One phase: the manifest, its gate steps and its reconciliation agree on it.
      const { phaseId } = record.value;
      expect(attribution.value.phase).toBe(phaseId);
      expect(reconciliation.value.phaseId).toBe(phaseId);
    });
  },
);

// An attempt's gate request is born with $schema: no pre-schema shape, and
// any key beyond its five is refused, as phax's decoder does.
describe("gate-request, born with $schema", () => {
  const document = validDocuments["gate-request"];
  const current = CURRENT_SHAPES["gate-request"];

  it("parses the document phax writes as its current shape, with phax's value", () => {
    expect(Object.keys(document)).toEqual(["$schema", "phase", "base", "terminal", "phases"]);
    const phax = decodeGateRequestFile(document);
    if (Result.isFailure(phax)) throw new Error("document rejected by phax");
    expect(parseGateRequest(document)).toEqual({ ok: true, shape: current, value: phax.success });
  });

  it("is identified by parseDocument from its $schema", () => {
    expect(parseDocument(document)).toMatchObject({
      ok: true,
      format: "gate-request",
      shape: current,
    });
  });

  it("fails a document without $schema at $schema", () => {
    expect(parseGateRequest(withoutKey(document, "$schema"))).toMatchObject({
      ok: false,
      error: { path: "$schema", message: missingSchemaMessage("gate request") },
    });
  });

  it("rejects an extra key, as phax's strict decoder does", () => {
    const extra = withKey(document, "touched", ["src/example.ts"]);
    expect(parseGateRequest(extra).ok).toBe(false);
    expect(Result.isFailure(decodeGateRequestFile(extra))).toBe(true);
  });

  it("drops $schema on upgrade and keeps every other key", () => {
    const result = parseGateRequest(document);
    if (!result.ok) throw new Error("document rejected");
    expect(toLatestGateRequest(result.value)).toEqual(withoutKey(document, "$schema"));
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl("gate-request", NEWER_RELEASE));
    const message = newerReleaseMessage("gate-request", NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [parseGateRequest(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

it("a phax-written timeline file without its $schema is the pre-schema shape", () => {
  for (const { id, parse } of FORMATS) {
    expect(parse(withoutKey(validDocuments[id], "$schema")), id).toMatchObject({
      ok: true,
      shape: "pre-schema",
    });
  }
});
