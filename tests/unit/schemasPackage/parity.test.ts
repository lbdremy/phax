import { Either } from "effect";
import { describe, expect, it } from "vitest";
import { parsePhaseRecordManifest } from "../../../packages/schemas/src/index.js";
import { decodeRunRecordManifest } from "../../../src/schemas/runRecord.js";

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
  ["a version-1 manifest", { ...withoutVerifiedSurfaces, version: 1 }],
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
});
