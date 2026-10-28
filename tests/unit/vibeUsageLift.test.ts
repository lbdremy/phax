import { Either } from "effect";
import { describe, expect, it } from "vitest";
import {
  parseDocument,
  toLatestAuthoringRecordManifest,
  toLatestDecisionRecordManifest,
  toLatestInteractiveSession,
  toLatestPhaseRecordManifest,
  type AnyDocument,
} from "../../packages/schemas/src/index.js";
import {
  readInteractiveSessionFile,
  readRecordManifestFile,
  type PersistedReadError,
} from "../../src/schemas/persisted.js";
import { schemaUrl, type FormatId } from "../../src/schemas/schemaUrl.js";
import {
  builderInteractiveSessionDocument,
  preSchemaDocuments,
  validDocuments,
  withKey,
  withoutKey,
  type Doc,
} from "./schemasPackage/documents.js";

// A record stamped below 0.30.0 reads through its frozen decoder and lifts to
// the current shape: Claude Code and Codex usage as recorded, a Vibe usage to
// unavailable (a frozen one counted a whole session from its meta.json).

const CLAUDE = {
  available: true,
  usage: {
    provider: "claude-code",
    inputTokens: 1000,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 200,
    outputTokens: 300,
    totalCostUsd: 0.01,
  },
};

const CODEX = {
  available: true,
  usage: {
    provider: "codex-cli",
    inputTokens: 500,
    cachedInputTokens: 100,
    outputTokens: 200,
    reasoningOutputTokens: 30,
  },
};

const FROZEN_VIBE = {
  available: true,
  usage: {
    provider: "mistral-vibe",
    inputTokens: 10,
    outputTokens: 2,
    sessionCostUsd: 0.01,
    toolCallsAgreed: 1,
    toolCallsRejected: 0,
    toolCallsFailed: 0,
    toolCallsSucceeded: 1,
  },
};

const UNAVAILABLE = { available: false };

const USAGES: ReadonlyArray<readonly [provider: string, usage: Doc, lifted: Doc]> = [
  ["claude-code", CLAUDE, CLAUDE],
  ["codex-cli", CODEX, CODEX],
  ["mistral-vibe", FROZEN_VIBE, UNAVAILABLE],
];

/** A current-shape document restamped at `stamp`, carrying `usage` where its format keeps one. */
type Frozen = (stamp: string, usage: Doc) => Doc;

const phase: Frozen = (stamp, usage) =>
  withKey(
    withKey(
      validDocuments["phase-record-manifest"],
      "$schema",
      schemaUrl("phase-record-manifest", stamp),
    ),
    "usage",
    usage,
  );

const authoring: Frozen = (stamp, usage) =>
  withKey(
    withKey(
      validDocuments["authoring-record-manifest"],
      "$schema",
      schemaUrl("authoring-record-manifest", stamp),
    ),
    "usage",
    usage,
  );

const decision: Frozen = (stamp, usage) =>
  withKey(
    withKey(
      validDocuments["decision-record-manifest"],
      "$schema",
      schemaUrl("decision-record-manifest", stamp),
    ),
    "usage",
    usage,
  );

const session: Frozen = (stamp, usage) =>
  withKey(
    withKey(builderInteractiveSessionDocument, "$schema", schemaUrl("interactive-session", stamp)),
    "builderUsage",
    usage,
  );

const phaseBefore026: Frozen = (stamp, usage) =>
  withoutKey(withoutKey(withoutKey(phase(stamp, usage), "oracle"), "mode"), "stop");

const authoringBefore023: Frozen = (stamp, usage) => withoutKey(authoring(stamp, usage), "retry");

type Row = readonly [
  label: string,
  format: FormatId,
  stamp: string,
  frozen: Frozen,
  /** The key of the current document that holds the usage. */
  usageKey: "usage" | "builderUsage",
];

const ROWS: ReadonlyArray<Row> = [
  ["phase-record-manifest", "phase-record-manifest", "0.26.0", phase, "usage"],
  ["phase-record-manifest", "phase-record-manifest", "0.29.0", phase, "usage"],
  ["phase-record-manifest", "phase-record-manifest", "0.17.0", phaseBefore026, "usage"],
  ["authoring-record-manifest", "authoring-record-manifest", "0.23.0", authoring, "usage"],
  ["authoring-record-manifest", "authoring-record-manifest", "0.29.0", authoring, "usage"],
  ["authoring-record-manifest", "authoring-record-manifest", "0.17.0", authoringBefore023, "usage"],
  ["decision-record-manifest", "decision-record-manifest", "0.28.0", decision, "usage"],
  ["decision-record-manifest", "decision-record-manifest", "0.29.0", decision, "usage"],
  ["decision-record-manifest", "decision-record-manifest", "0.25.0", decision, "usage"],
  ["interactive-session", "interactive-session", "0.26.0", session, "builderUsage"],
  ["interactive-session", "interactive-session", "0.29.0", session, "builderUsage"],
];

const FILE = "/home/example/.phax/example/record.json";

function read(format: FormatId, document: Doc): Either.Either<object, PersistedReadError> {
  return format === "interactive-session"
    ? readInteractiveSessionFile(FILE, document)
    : readRecordManifestFile(FILE, document);
}

function currentOf(format: FormatId): Doc {
  return format === "interactive-session"
    ? builderInteractiveSessionDocument
    : validDocuments[format];
}

function expectedValue(format: FormatId, usageKey: string, lifted: Doc): Doc {
  const { $schema: _schema, ...recorded } = currentOf(format) as Doc & { $schema: unknown };
  return { ...recorded, [usageKey]: lifted };
}

describe("a record stamped below 0.30.0 reads through its frozen decoder (phax)", () => {
  it.each(ROWS.flatMap((row) => USAGES.map((usage) => [...row, ...usage] as const)))(
    "%s at %s: %s usage",
    (_label, format, stamp, frozen, usageKey, _provider, usage, lifted) => {
      const value = read(format, frozen(stamp, usage));
      if (Either.isLeft(value)) throw new Error(value.left.message);
      expect(value.right).toEqual(expectedValue(format, usageKey, lifted));
      expect(value.right).not.toHaveProperty("$schema");
    },
  );

  it("lifts a Vibe usage a pre-schema record carried to unavailable too", () => {
    for (const id of ["phase-record-manifest", "authoring-record-manifest"] as const) {
      const value = readRecordManifestFile(
        FILE,
        withKey(preSchemaDocuments[id], "usage", FROZEN_VIBE),
      );
      if (Either.isLeft(value)) throw new Error(value.left.message);
      expect(value.right).toMatchObject({ usage: UNAVAILABLE });
    }
  });

  it("refuses a record stamped 0.30.0 that carries the frozen Vibe usage", () => {
    for (const [format, frozen, usageKey] of [
      ["phase-record-manifest", phase, "usage"],
      ["authoring-record-manifest", authoring, "usage"],
      ["decision-record-manifest", decision, "usage"],
      ["interactive-session", session, "builderUsage"],
    ] as const) {
      const document = frozen("0.30.0", FROZEN_VIBE);
      expect(document[usageKey], format).toEqual(FROZEN_VIBE);
      expect(Either.isLeft(read(format, document)), format).toBe(true);
    }
  });

  it("reads a record stamped 0.30.0 with a current Vibe usage as recorded", () => {
    const current = {
      available: true,
      usage: {
        provider: "mistral-vibe",
        inputTokens: 45575,
        cachedInputTokens: 12800,
        outputTokens: 291,
        costUsd: 0.070545,
      },
    };
    for (const [format, frozen, usageKey] of [
      ["phase-record-manifest", phase, "usage"],
      ["authoring-record-manifest", authoring, "usage"],
      ["decision-record-manifest", decision, "usage"],
      ["interactive-session", session, "builderUsage"],
    ] as const) {
      const value = read(format, frozen("0.30.0", current));
      if (Either.isLeft(value)) throw new Error(value.left.message);
      expect(value.right, format).toMatchObject({ [usageKey]: current });
    }
  });
});

function upgraded(document: Doc): unknown {
  const parsed = parseDocument(document);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const any = parsed as Extract<ReturnType<typeof parseDocument>, { ok: true }> & AnyDocument;
  switch (any.format) {
    case "phase-record-manifest":
      return toLatestPhaseRecordManifest(any.value);
    case "authoring-record-manifest":
      return toLatestAuthoringRecordManifest(any.value);
    case "decision-record-manifest":
      return toLatestDecisionRecordManifest(any.value);
    case "interactive-session":
      return toLatestInteractiveSession(any.value);
    default:
      throw new Error(`unexpected format ${any.format}`);
  }
}

describe("a record stamped below 0.30.0 upgrades the same way through the schemas package", () => {
  it.each(ROWS.flatMap((row) => USAGES.map((usage) => [...row, ...usage] as const)))(
    "%s at %s: %s usage",
    (_label, format, stamp, frozen, usageKey, _provider, usage, lifted) => {
      expect(upgraded(frozen(stamp, usage))).toEqual(expectedValue(format, usageKey, lifted));
    },
  );

  it("keeps a current Vibe usage as recorded", () => {
    const current = {
      available: true,
      usage: {
        provider: "mistral-vibe",
        inputTokens: 10987,
        cachedInputTokens: 3200,
        outputTokens: 3,
        costUsd: 0.016503,
      },
    };
    expect(upgraded(phase("0.30.0", current))).toMatchObject({ usage: current });
    expect(upgraded(session("0.30.0", current))).toMatchObject({ builderUsage: current });
  });
});
