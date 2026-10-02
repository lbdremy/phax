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
import { decodeComplianceReviewFile } from "../../../src/schemas/complianceReview.js";
import { decodePhaxPlanFile } from "../../../src/schemas/phaxPlan.js";
import { decodeRegistryFile } from "../../../src/schemas/registry.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import { decodePhaseStatusFile, decodeRunStatusFile } from "../../../src/schemas/status.js";
import { preSchemaDocuments, validDocuments, withKey, withoutKey } from "./documents.js";

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
    phax: decodeComplianceReviewFile,
    toLatest: toLatestComplianceReview,
  },
];

const decodeFile: { readonly [F in "phax-plan" | "compliance-review"]: Decode } = {
  "phax-plan": decodePhaxPlanFile,
  "compliance-review": decodeComplianceReviewFile,
};

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

describe.each(FORMATS)("$id", (format) => {
  const document = validDocuments[format.id];
  const preSchema = preSchemaDocuments[format.id];

  it("parses the pre-schema document as shape pre-schema", () => {
    expect(format.parse(preSchema)).toEqual({ ok: true, shape: "pre-schema", value: preSchema });
  });

  it("parses the document phax writes as shape next, with phax's value", () => {
    const phax = format.phax(document);
    if (Either.isLeft(phax)) throw new Error("document rejected by phax");
    expect(format.parse(document)).toEqual({ ok: true, shape: "next", value: phax.right });
  });

  it("identifies the document phax writes by its $schema alone as shape next (ac-identify-alone)", () => {
    expect(parseDocument(document)).toMatchObject({ ok: true, format: format.id, shape: "next" });
  });

  it("drops $schema when upgrading the document phax writes, and carries no version", () => {
    const result = format.parse(document);
    if (!result.ok) throw new Error("document rejected");
    const latest = format.toLatest(result.value as never);
    expect(latest).toEqual(withoutKey(document, "$schema"));
    expect(latest).not.toHaveProperty("version");
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

describe.each([
  { id: "run-status", parse: parseRunStatus },
  { id: "phase-status", parse: parsePhaseStatus },
] as const)("$id written by phax", ({ id, parse }) => {
  const written = validDocuments[id];

  it("fails at state when the state is unknown (ac-failure)", () => {
    const result = parse(withKey(written, "state", "paused"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.path).toBe("state");
  });
});

describe.each([
  { id: "phax-plan", parse: parsePhaxPlan },
  { id: "compliance-review", parse: parseComplianceReview },
] as const)("$id written by phax", ({ id, parse }) => {
  const written = validDocuments[id];

  it("rejects an unknown key, as phax's strict decoder does", () => {
    const result = parse(withKey(written, "extra", true));
    expect(result.ok).toBe(false);
    expect(Either.isLeft(decodeFile[id](withKey(written, "extra", true)))).toBe(true);
  });

  it("rejects a document that carries both $schema and version", () => {
    expect(parse(withKey(written, "version", 1)).ok).toBe(false);
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
