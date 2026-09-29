import { Either, JSONSchema, type ParseResult, type Schema } from "effect";
import { describe, expect, it } from "vitest";
import { PACKAGE_VERSION } from "../../../packages/schemas/src/generated/index.js";
import {
  ComplianceReviewV1Schema,
  decodeComplianceReviewV1,
} from "../../../packages/schemas/src/history/compliance-review/v1.js";
import {
  PhaseStatusV1Schema,
  decodePhaseStatusV1,
} from "../../../packages/schemas/src/history/phase-status/v1.js";
import { decodePhaxPlanV1 } from "../../../packages/schemas/src/history/phax-plan/v1.js";
import {
  RegistryV1Schema,
  decodeRegistryV1,
} from "../../../packages/schemas/src/history/registry/v1.js";
import { decodeRunStatusV1 } from "../../../packages/schemas/src/history/run-status/v1.js";
import {
  UNKNOWN,
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
  type PhaxPlanV1,
  type RunStatusV1,
} from "../../../packages/schemas/src/index.js";
import { newerReleaseMessage } from "../../../packages/schemas/src/shapes.js";
import {
  ComplianceReviewSchema,
  decodeComplianceReview,
} from "../../../src/schemas/complianceReview.js";
import { decodePhaxPlan } from "../../../src/schemas/phaxPlan.js";
import { RegistrySchema, decodeRegistry } from "../../../src/schemas/registry.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { schemaUrl } from "../../../src/schemas/schemaUrl.js";
import {
  PhaseStatusSchema,
  decodePhaseStatus,
  decodeRunStatus,
} from "../../../src/schemas/status.js";
import { keySignature, readSurveyedFixtures, surveyGroups } from "./surveyedFixtures.js";

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;

interface RunDirectoryFormat {
  readonly id: FormatId;
  readonly parse: (input: unknown) => {
    readonly ok: boolean;
    readonly shape?: string;
    readonly value?: unknown;
  };
  readonly phax: Decode;
  readonly frozen: Decode;
  readonly toLatest: (value: never) => unknown;
  /** Set for the formats with one signature, whose frozen module is an exact twin. */
  readonly twin?: { readonly frozen: Schema.Schema.Any; readonly phax: Schema.Schema.Any };
}

const FORMATS: ReadonlyArray<RunDirectoryFormat> = [
  {
    id: "registry",
    parse: parseRegistry,
    phax: decodeRegistry,
    frozen: decodeRegistryV1,
    toLatest: toLatestRegistry,
    twin: { frozen: RegistryV1Schema, phax: RegistrySchema },
  },
  {
    id: "run-status",
    parse: parseRunStatus,
    phax: decodeRunStatus,
    frozen: decodeRunStatusV1,
    toLatest: toLatestRunStatus,
  },
  {
    id: "phase-status",
    parse: parsePhaseStatus,
    phax: decodePhaseStatus,
    frozen: decodePhaseStatusV1,
    toLatest: toLatestPhaseStatus,
    twin: { frozen: PhaseStatusV1Schema, phax: PhaseStatusSchema },
  },
  {
    id: "phax-plan",
    parse: parsePhaxPlan,
    phax: decodePhaxPlan,
    frozen: decodePhaxPlanV1,
    toLatest: toLatestPhaxPlan,
  },
  {
    id: "compliance-review",
    parse: parseComplianceReview,
    phax: decodeComplianceReview,
    frozen: decodeComplianceReviewV1,
    toLatest: toLatestComplianceReview,
    twin: { frozen: ComplianceReviewV1Schema, phax: ComplianceReviewSchema },
  },
];

// Derived from the package version, so a release bump never breaks these tests.
const NEWER_RELEASE = `${Number(PACKAGE_VERSION.split(".")[0]) + 1}.0.0`;

function withoutVersion(value: unknown): Record<string, unknown> {
  const { version: _version, ...rest } = value as Record<string, unknown>;
  return rest;
}

describe.each(FORMATS)("$id", (format) => {
  const groups = surveyGroups(format.id);
  const fixtures = readSurveyedFixtures(format.id, "v1");
  const accepted = fixtures.filter(({ document }) => Either.isRight(format.phax(document)));

  it("has one real document per surveyed signature, keyed by that signature", () => {
    expect(fixtures.map(({ signature }) => signature).toSorted()).toEqual(
      groups.map(({ keys }) => keys).toSorted(),
    );
    for (const { signature, document } of fixtures) expect(keySignature(document)).toBe(signature);
  });

  it("gets phax's verdict on each fixture: rejected exactly when its group was", () => {
    for (const { signature, document } of fixtures) {
      const group = groups.find(({ keys }) => keys === signature);
      expect(Either.isLeft(format.phax(document)), signature).toBe((group?.rejected ?? 0) > 0);
    }
  });

  it("parses every fixture as shape v1, with phax's value whenever phax accepts it", () => {
    for (const { signature, document } of fixtures) {
      const result = format.parse(document);
      expect(result, signature).toMatchObject({ ok: true, shape: "v1" });
      const phax = format.phax(document);
      if (Either.isRight(phax)) expect(result.value, signature).toEqual(phax.right);
    }
  });

  it("has a frozen v1 module that gives phax's value on every fixture phax accepts", () => {
    expect(accepted.length).toBeGreaterThan(0);
    for (const { signature, document } of accepted) {
      const frozen = format.frozen(document);
      const phax = format.phax(document);
      expect(Either.isRight(frozen), signature).toBe(true);
      if (Either.isRight(frozen) && Either.isRight(phax)) {
        expect(frozen.right, signature).toEqual(phax.right);
      }
    }
  });

  it("upgrades every fixture without a version, and never throws", () => {
    for (const { document } of fixtures) {
      const result = format.parse(document);
      if (!result.ok) throw new Error("fixture rejected");
      const latest = format.toLatest(result.value as never) as Record<string, unknown>;
      expect(Object.hasOwn(latest, "version")).toBe(false);
    }
  });

  it("fails a document written by a newer release with the upgrade message", () => {
    const [first] = fixtures;
    const document = {
      ...(first?.document as object),
      $schema: schemaUrl(format.id, NEWER_RELEASE),
    };
    const message = newerReleaseMessage(format.id, NEWER_RELEASE, PACKAGE_VERSION);
    for (const result of [format.parse(document), parseDocument(document)]) {
      expect(result).toEqual({ ok: false, error: { path: "$schema", message } });
    }
  });
});

describe("a single-signature format's frozen v1 twin", () => {
  const twins = FORMATS.flatMap(({ id, twin }) => (twin === undefined ? [] : [{ id, ...twin }]));

  it("exists for exactly the registry, the phase status and the compliance review", () => {
    expect(twins.map(({ id }) => id)).toEqual(["registry", "phase-status", "compliance-review"]);
  });

  it.each(twins)("$id: has the same JSON Schema as phax's", ({ frozen, phax }) => {
    expect(JSONSchema.make(frozen)).toEqual(JSONSchema.make(phax));
  });
});

describe("toLatest keeps every recorded fact and marks only what an older signature lacked", () => {
  it.each(["registry", "phase-status", "compliance-review"] as const)(
    "%s: drops version and keeps everything else",
    (id) => {
      const format = FORMATS.find((entry) => entry.id === id);
      if (format === undefined) throw new Error(id);
      for (const { document } of readSurveyedFixtures(id, "v1")) {
        const result = format.parse(document);
        if (!result.ok) throw new Error("fixture rejected");
        expect(format.toLatest(result.value as never)).toEqual(withoutVersion(result.value));
      }
    },
  );

  it("run-status: marks namespace unknown only when the run never recorded it", () => {
    const fixtures = readSurveyedFixtures("run-status", "v1");
    let without = 0;
    for (const { signature, document } of fixtures) {
      const result = parseRunStatus(document);
      if (!result.ok) throw new Error("fixture rejected");
      const value: RunStatusV1 = result.value;
      const latest = toLatestRunStatus(value);
      const recorded = withoutVersion(value);
      if (value.namespace === undefined) {
        without++;
        expect(latest, signature).toEqual({ ...recorded, namespace: UNKNOWN });
      } else {
        expect(latest, signature).toEqual(recorded);
      }
      expect(Object.keys(latest).toSorted(), signature).toEqual(
        [...new Set([...Object.keys(recorded), "namespace"])].toSorted(),
      );
    }
    expect(without).toBe(2);
  });

  it("phax-plan: marks requiredCommands and the planned-file lists unknown, and drops run.backend", () => {
    const fixtures = readSurveyedFixtures("phax-plan", "v1");
    const lists = ["plannedFilesToCreate", "plannedFilesToEdit", "optionalFilesToEdit"] as const;
    const seen = { withoutRequiredCommands: 0, withBackend: 0, withoutLists: 0 };
    for (const { signature, document } of fixtures) {
      const result = parsePhaxPlan(document);
      if (!result.ok) throw new Error("fixture rejected");
      const value: PhaxPlanV1 = result.value;
      const latest = toLatestPhaxPlan(value);
      expect(Object.keys(latest).toSorted(), signature).toEqual(["phases", "run"]);

      const { backend, requiredCommands, ...run } = value.run as Record<string, unknown>;
      if (backend !== undefined) seen.withBackend++;
      if (requiredCommands === undefined) seen.withoutRequiredCommands++;
      expect(latest.run, signature).toEqual({
        ...run,
        requiredCommands: requiredCommands ?? UNKNOWN,
      });

      expect(latest.phases).toHaveLength(value.phases.length);
      value.phases.forEach((phase, index) => {
        const upgraded = latest.phases[index];
        const hasLists = "plannedFilesToCreate" in phase;
        if (!hasLists) seen.withoutLists++;
        expect(upgraded, signature).toEqual({
          ...phase,
          ...(hasLists ? {} : Object.fromEntries(lists.map((list) => [list, UNKNOWN]))),
        });
      });
    }
    expect(seen.withoutRequiredCommands).toBe(3);
    expect(seen.withBackend).toBe(2);
    expect(seen.withoutLists).toBeGreaterThan(0);
  });

  it("phax-plan: keeps a current plan's recorded lists and commands as they are", () => {
    const [current] = readSurveyedFixtures("phax-plan", "v1").filter(({ document }) =>
      Either.isRight(decodePhaxPlan(document)),
    );
    const result = parsePhaxPlan(current?.document);
    if (!result.ok) throw new Error("fixture rejected");
    expect(toLatestPhaxPlan(result.value)).toEqual(withoutVersion(result.value));
  });
});
