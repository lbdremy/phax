import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  parseComplianceReview,
  parseDocument,
  parsePhaseStatus,
  parsePhaxPlan,
  parseRegistry,
  parseRunStatus,
  toLatestComplianceReview,
  toLatestPhaseStatus,
  toLatestPhaxPlan,
  toLatestRegistry,
  toLatestRunStatus,
} from "../../../packages/schemas/src/index.js";
import { newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import { decodeComplianceReview } from "../../../src/schemas/complianceReview.js";
import { decodePhaxPlanFile } from "../../../src/schemas/phaxPlan.js";
import { decodeRegistryFile } from "../../../src/schemas/registry.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { decodePhaseStatusFile, decodeRunStatusFile } from "../../../src/schemas/status.js";
import {
  preSchemaDocuments,
  validDocuments,
  withKey,
  withoutKey,
  WRITES_SCHEMA,
} from "./documents.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

interface RunDirectoryFormat {
  readonly id: FormatId;
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly shape?: string;
    readonly value?: unknown;
  };
  readonly phax: Decode;
  readonly toLatest: (value: never) => unknown;
}

const FORMATS: ReadonlyArray<RunDirectoryFormat> = [
  { id: "registry", parse: parseRegistry, phax: decodeRegistryFile, toLatest: toLatestRegistry },
  {
    id: "run-status",
    parse: parseRunStatus,
    phax: decodeRunStatusFile,
    toLatest: toLatestRunStatus,
  },
  {
    id: "phase-status",
    parse: parsePhaseStatus,
    phax: decodePhaseStatusFile,
    toLatest: toLatestPhaseStatus,
  },
  { id: "phax-plan", parse: parsePhaxPlan, phax: decodePhaxPlanFile, toLatest: toLatestPhaxPlan },
  {
    id: "compliance-review",
    parse: parseComplianceReview,
    phax: decodeComplianceReview,
    toLatest: toLatestComplianceReview,
  },
];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

describe.each(FORMATS)("$id", (format) => {
  const document = validDocuments[format.id];
  const preSchema = preSchemaDocuments[format.id];
  const writtenShape = WRITES_SCHEMA.has(format.id) ? "next" : "pre-schema";

  it("parses the pre-schema document as shape pre-schema", () => {
    expect(format.parse(preSchema)).toEqual({ ok: true, shape: "pre-schema", value: preSchema });
  });

  it("parses the document phax writes with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: writtenShape, value: phax.right });
  });

  it("fails a document the frozen decoder rejects as older than the first release that writes $schema", () => {
    const result = format.parse(withKey(preSchema, "version", 0)) as {
      readonly ok: boolean;
      readonly error?: { readonly path: string; readonly message: string };
    };
    expect(result.ok).toBe(false);
    expect(result.error?.path).toBe("version");
    expect(result.error?.message).toContain("older than the first release that writes $schema");
  });

  it("upgrades by dropping version and keeping everything else", () => {
    const result = format.parse(preSchema);
    if (!result.ok) throw new Error("document rejected");
    expect(format.toLatest(result.value as never)).toEqual(withoutKey(preSchema, "version"));
  });

  it("upgrades the pre-schema document and the document phax writes to the same value", () => {
    const old = format.parse(preSchema);
    const written = format.parse(document);
    if (!old.ok || !written.ok) throw new Error("document rejected");
    expect(format.toLatest(written.value as never)).toEqual(format.toLatest(old.value as never));
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const newer = withKey(document, "$schema", schemaUrl(format.id, NEWER_RELEASE));
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(newer), parseDocument(newer)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

describe("registry written by phax", () => {
  const written = validDocuments.registry;

  it("is identified by its $schema alone as shape next (ac-identify-alone)", () => {
    const result = parseDocument(written);
    expect(result).toMatchObject({ ok: true, format: "registry", shape: "next" });
  });

  it("drops $schema on upgrade, and carries no version", () => {
    const result = parseRegistry(written);
    if (!result.ok) throw new Error("document rejected");
    expect(result.shape).toBe("next");
    const latest = toLatestRegistry(result.value);
    expect(latest).toEqual(withoutKey(written, "$schema"));
    expect(latest).not.toHaveProperty("version");
  });
});

describe.each([
  { id: "run-status", parse: parseRunStatus, toLatest: toLatestRunStatus },
  { id: "phase-status", parse: parsePhaseStatus, toLatest: toLatestPhaseStatus },
] as const)("$id written by phax", ({ id, parse, toLatest }) => {
  const written = validDocuments[id];

  it("is identified by its $schema alone as shape next (ac-identify-alone)", () => {
    expect(parseDocument(written)).toMatchObject({ ok: true, format: id, shape: "next" });
  });

  it("drops $schema on upgrade, and carries no version", () => {
    const result = parse(written);
    if (!result.ok) throw new Error("document rejected");
    expect(result.shape).toBe("next");
    const latest = toLatest(result.value as never);
    expect(latest).toEqual(withoutKey(written, "$schema"));
    expect(latest).not.toHaveProperty("version");
  });

  it("fails at state when the state is unknown (ac-failure)", () => {
    const result = parse(withKey(written, "state", "paused"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe("state");
  });
});

describe("toLatestPhaxPlan", () => {
  it("keeps run.requiredCommands and every phase's planned-file lists as recorded", () => {
    const result = parsePhaxPlan(validDocuments["phax-plan"]);
    if (!result.ok) throw new Error("document rejected");
    const latest = toLatestPhaxPlan(result.value);
    expect(latest.run.requiredCommands).toEqual(result.value.run.requiredCommands);
    expect(latest.phases[0].plannedFilesToCreate).toEqual(["src/example.ts"]);
    expect(latest.phases[0].plannedFilesToEdit).toEqual(["src/index.ts"]);
    expect(latest.phases[0].optionalFilesToEdit).toEqual(["README.md"]);
  });
});
