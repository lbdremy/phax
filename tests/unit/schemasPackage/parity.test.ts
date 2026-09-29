import { Either, type ParseResult } from "effect";
import { describe, expect, it } from "vitest";
import {
  parseComplianceReview,
  parsePhaseRecordManifest,
  parsePhaseStatus,
  parsePhaxPlan,
  parseRegistry,
  parseRunStatus,
} from "../../../packages/schemas/src/index.js";
import { decodeComplianceReview } from "../../../src/schemas/complianceReview.js";
import { decodePhaxPlan } from "../../../src/schemas/phaxPlan.js";
import { decodeRegistry } from "../../../src/schemas/registry.js";
import { decodeRunRecordManifest } from "../../../src/schemas/runRecord.js";
import type { FormatId } from "../../../src/schemas/schemaUrl.js";
import { decodePhaseStatus, decodeRunStatus } from "../../../src/schemas/status.js";
import { readSurveyedFixtures } from "./surveyedFixtures.js";

const base = {
  version: 2,
  runId: "records-1786807559589",
  phaseId: "phase-02",
  shape: "skeleton",
  sourceSha: "9fd2b07f",
  model: "gpt-5.5",
  effort: "medium",
  provider: "codex-cli",
  outcome: "committed",
  usage: {
    available: true,
    usage: {
      provider: "codex-cli",
      inputTokens: 31299,
      cachedInputTokens: 2432,
      outputTokens: 5,
      reasoningOutputTokens: 0,
    },
  },
  verifiedSurfaces: ["local"],
};

const { sourceSha: _sourceSha, ...withoutSourceSha } = base;
const { verifiedSurfaces: _verifiedSurfaces, ...withoutVerifiedSurfaces } = base;

const cases: ReadonlyArray<readonly [string, unknown]> = [
  ["a full version-2 manifest", base],
  ["a manifest without sourceSha", withoutSourceSha],
  [
    "an interrupted phase with unavailable usage",
    { ...base, outcome: "interrupted", usage: { available: false } },
  ],
  [
    "a vibe manifest",
    {
      ...base,
      provider: "mistral-vibe",
      usage: {
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
      },
      verifiedSurfaces: ["local", "structural", "product"],
    },
  ],
  ["a manifest with one unknown key", { ...base, reviewer: "human" }],
  ["a manifest missing verifiedSurfaces", withoutVerifiedSurfaces],
  ["a manifest whose outcome is paused", { ...base, outcome: "paused" }],
  ["a version-3 manifest", { ...base, version: 3 }],
  ["a manifest with an empty runId", { ...base, runId: "" }],
  ["a manifest with an empty sourceSha", { ...base, sourceSha: "" }],
  ["a manifest with an unknown surface", { ...base, verifiedSurfaces: ["cloud"] }],
  ["a manifest with usage available but absent", { ...base, usage: { available: true } }],
  [
    "a manifest whose usage carries an extra key",
    {
      ...base,
      usage: { ...base.usage, usage: { ...base.usage.usage, costUsd: 1 } },
    },
  ],
  ["a non-object", "record.json"],
];

describe("parity: parsePhaseRecordManifest agrees with phax's decoder", () => {
  it.each(cases)("%s", (_label, input) => {
    const phax = decodeRunRecordManifest(input);
    const pkg = parsePhaseRecordManifest(input);
    expect(pkg.ok).toBe(Either.isRight(phax));
    if (pkg.ok && Either.isRight(phax)) expect(pkg.value).toEqual(phax.right);
  });

  it("covers accepted and rejected documents", () => {
    const verdicts = cases.map(([, input]) => parsePhaseRecordManifest(input).ok);
    expect(verdicts).toContain(true);
    expect(verdicts).toContain(false);
  });

  it("rejects a manifest with one unknown key, as phax does", () => {
    const input = { ...base, reviewer: "human" };
    expect(Either.isLeft(decodeRunRecordManifest(input))).toBe(true);
    const result = parsePhaseRecordManifest(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.path).toBe("reviewer");
  });

  it("reads a version-2 manifest through phax's decoder, as shape v2", () => {
    expect(parsePhaseRecordManifest(base)).toMatchObject({ ok: true, shape: "v2" });
  });

  // §5.7 promises parity only for the shape phax currently writes: the
  // package also reads the history phax itself no longer accepts.
  it("accepts a version-1 manifest that phax's decoder rejects, by design", () => {
    const v1 = { ...withoutVerifiedSurfaces, version: 1 };
    expect(Either.isLeft(decodeRunRecordManifest(v1))).toBe(true);
    expect(parsePhaseRecordManifest(v1)).toEqual({ ok: true, shape: "v1", value: v1 });
  });
});

type Decode = (input: unknown) => Either.Either<unknown, ParseResult.ParseError>;
type Parse = (input: unknown) => { readonly ok: boolean; readonly value?: unknown };
type Doc = Readonly<Record<string, unknown>>;

/** The first fixture phax's current decoder accepts: a document of the current shape. */
function currentShape(id: FormatId, decode: Decode): Doc {
  const found = readSurveyedFixtures(id, "v1").find(({ document }) =>
    Either.isRight(decode(document)),
  );
  if (found === undefined) throw new Error(`no current-shape ${id} fixture`);
  return found.document as Doc;
}

function first(list: unknown): Doc {
  return (list as ReadonlyArray<Doc>)[0] as Doc;
}

interface RunDirectoryParity {
  readonly id: FormatId;
  readonly parse: Parse;
  readonly phax: Decode;
  readonly cases: ReadonlyArray<readonly [string, unknown, "accepted" | "rejected"]>;
}

const registry = currentShape("registry", decodeRegistry);
const runStatus = currentShape("run-status", decodeRunStatus);
const phaseStatus = currentShape("phase-status", decodePhaseStatus);
const phaxPlan = currentShape("phax-plan", decodePhaxPlan);
const complianceReview = currentShape("compliance-review", decodeComplianceReview);

// Each rejected case is one no frozen module admits either, so the package's
// fallback never changes the verdict on a current-shape document.
const RUN_DIRECTORY: ReadonlyArray<RunDirectoryParity> = [
  {
    id: "registry",
    parse: parseRegistry,
    phax: decodeRegistry,
    cases: [
      ["a real registry", registry, "accepted"],
      ["a registry with one unknown key", { ...registry, owner: "remy" }, "accepted"],
      ["an empty registry", { version: 1, runs: [] }, "accepted"],
      [
        "a run in an unknown state",
        { ...registry, runs: [{ ...first(registry["runs"]), state: "paused" }] },
        "rejected",
      ],
      [
        "a run with an empty archivePath",
        { ...registry, runs: [{ ...first(registry["runs"]), archivePath: "" }] },
        "rejected",
      ],
      ["a registry whose runs is not an array", { ...registry, runs: {} }, "rejected"],
      ["a version-2 registry", { ...registry, version: 2 }, "rejected"],
    ],
  },
  {
    id: "run-status",
    parse: parseRunStatus,
    phax: decodeRunStatus,
    cases: [
      ["a real run status", runStatus, "accepted"],
      ["a run status with one unknown key", { ...runStatus, owner: "remy" }, "accepted"],
      ["a paused run status", { ...runStatus, state: "paused" }, "rejected"],
      [
        "a run status whose phasesCount is a string",
        { ...runStatus, phasesCount: "3" },
        "rejected",
      ],
      ["a run status with an empty namespace", { ...runStatus, namespace: "" }, "rejected"],
      [
        "a run status whose allowSkillEdits is a string",
        { ...runStatus, allowSkillEdits: "yes" },
        "rejected",
      ],
    ],
  },
  {
    id: "phase-status",
    parse: parsePhaseStatus,
    phax: decodePhaseStatus,
    cases: [
      ["a real phase status", phaseStatus, "accepted"],
      ["a phase status with one unknown key", { ...phaseStatus, owner: "remy" }, "accepted"],
      ["a phase status in an unknown state", { ...phaseStatus, state: "paused" }, "rejected"],
      ["a phase status with an unknown effort", { ...phaseStatus, effort: "extreme" }, "rejected"],
      ["a branch name with a leading dash", { ...phaseStatus, branchName: "-x" }, "rejected"],
      ["a branch name with a space", { ...phaseStatus, branchName: "a b" }, "rejected"],
    ],
  },
  {
    id: "phax-plan",
    parse: parsePhaxPlan,
    phax: decodePhaxPlan,
    cases: [
      ["a real phax-plan", phaxPlan, "accepted"],
      ["a phax-plan with one unknown key", { ...phaxPlan, owner: "remy" }, "rejected"],
      [
        "a phax-plan whose run has one unknown key",
        { ...phaxPlan, run: { ...(phaxPlan["run"] as Doc), owner: "remy" } },
        "rejected",
      ],
      [
        "a phase whose id breaks the pattern",
        { ...phaxPlan, phases: [{ ...first(phaxPlan["phases"]), id: "phase-1" }] },
        "rejected",
      ],
      [
        "a phase with an unknown effort",
        { ...phaxPlan, phases: [{ ...first(phaxPlan["phases"]), effort: "extreme" }] },
        "rejected",
      ],
      ["a phax-plan without phases", { ...phaxPlan, phases: [] }, "rejected"],
    ],
  },
  {
    id: "compliance-review",
    parse: parseComplianceReview,
    phax: decodeComplianceReview,
    cases: [
      ["a real compliance review", complianceReview, "accepted"],
      [
        "a compliance review with one unknown key",
        { ...complianceReview, owner: "remy" },
        "rejected",
      ],
      [
        "a compliance review with an unknown verdict",
        { ...complianceReview, verdict: "maybe" },
        "rejected",
      ],
      [
        "a finding with an unknown severity",
        {
          ...complianceReview,
          perPhase: [
            {
              phaseId: "phase-01",
              verdict: "divergent",
              findings: [{ dimension: "files", severity: "fatal", message: "x" }],
            },
          ],
        },
        "rejected",
      ],
      [
        "a compliance review whose summary is a number",
        { ...complianceReview, summary: 1 },
        "rejected",
      ],
    ],
  },
];

describe.each(RUN_DIRECTORY)("parity: the package agrees with phax's decoder on $id", (format) => {
  const { parse, phax } = format;
  it.each(format.cases)("%s", (_label, input, verdict) => {
    const decoded = phax(input);
    const result = parse(input);
    expect(Either.isRight(decoded)).toBe(verdict === "accepted");
    expect(result.ok).toBe(verdict === "accepted");
    if (result.ok && Either.isRight(decoded)) expect(result.value).toEqual(decoded.right);
  });
});

describe("parity: one unknown key", () => {
  it("is accepted by both for a registry, a run status and a phase status, and dropped from the value", () => {
    const results = [
      parseRegistry({ ...registry, owner: "remy" }),
      parseRunStatus({ ...runStatus, owner: "remy" }),
      parsePhaseStatus({ ...phaseStatus, owner: "remy" }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(true);
      if (result.ok) expect(Object.hasOwn(result.value, "owner")).toBe(false);
    }
  });

  it("is rejected by both for a phax-plan and a compliance review, at the key", () => {
    const results = [
      parsePhaxPlan({ ...phaxPlan, owner: "remy" }),
      parseComplianceReview({ ...complianceReview, owner: "remy" }),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.path).toBe("owner");
    }
  });
});
