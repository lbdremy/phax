import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Schema } from "effect";
import { Backend, type AgentRunOptions } from "../../src/ports/backend.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { resolveReviewSecurityPolicy } from "../../src/domain/security/resolveReviewPolicy.js";
import type { StructuredCallId } from "../../src/domain/session/structuredCalls.js";
import { ProviderStoreRootsLive } from "../../src/infra/providerStoreRoots.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import {
  ANSWER_FORMATS,
  answerJsonSchema,
  type AnswerFormatId,
} from "../../src/schemas/answerSchemas.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";
import { resolveSecurityConfig } from "../../src/schemas/securityConfig.js";
import { validDocuments } from "../unit/schemasPackage/documents.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { probeProvider } from "./helpers/providers.js";

// Smoke test of Codex's `--output-schema` through phax's real Codex adapter:
// `exec` and then `exec resume` of the same session, for the spec, plan, two
// hand-decision and code-review answer schemas. The final message must decode
// with phax's decoder. Codex gets the whole schema, `$schema` included, so the
// model writes the stamp itself.
//
// Target versions: Claude Code 2.1.314, codex-cli 0.165.0.
//
// Neither the phase gate nor a phase agent runs this file (it hits the real
// CLI and needs PHAX_E2E_RUN=1); the PR review runs it by name:
//
//   PHAX_E2E_RUN=1 pnpm test:e2e:real tests/e2e/codexOutputSchema.test.ts
//
// A schema construct Codex refuses (the new session fails on the schema
// itself) becomes a coherence check for both providers (spec §10), never a
// flip and never a provider-only schema. Codex has no STRUCTURED_CALLS line to
// flip: it is always native.
const shouldRun = process.env["PHAX_E2E_RUN"] === "1" && probeProvider("codex");

// Pinned: with a ChatGPT login Codex serves only `gpt-6-luna`. On 2026-10-30
// `gpt-6-sol` (the config default) and `gpt-5.5` were refused.
const MODEL = "gpt-6-luna";
const EFFORT = "low";
const TIMEOUT = 300_000;

const FORMATS = [
  "spec-document",
  "plan-document",
  "spec-hand-decision-answer",
  "plan-hand-decision-answer",
  "code-review",
] as const satisfies readonly AnswerFormatId[];

const CALL_OF: Readonly<Record<(typeof FORMATS)[number], StructuredCallId>> = {
  "spec-document": "authoring",
  "plan-document": "authoring",
  "spec-hand-decision-answer": "decide-handback",
  "plan-hand-decision-answer": "decide-handback",
  "code-review": "code-review",
};

const askFor = (answer: unknown): string =>
  [
    "This is a smoke test of structured output. Do not read or change any file.",
    "Answer with exactly this JSON document, with every value as given:",
    JSON.stringify(answer),
  ].join("\n\n");

/** The default provider config with Codex enabled and `gpt-6-luna` as its only model. */
function providerConfig(): ProviderConfig {
  const codex = DEFAULT_PROVIDER_CONFIG.providers["codex-cli"]!;
  const gpt = codex.families?.["openai-gpt"];
  const luna = gpt?.models?.find((model) => model.id === MODEL);
  return {
    ...DEFAULT_PROVIDER_CONFIG,
    providers: {
      ...DEFAULT_PROVIDER_CONFIG.providers,
      "codex-cli": {
        ...codex,
        enabled: true,
        families: {
          ...codex.families,
          "openai-gpt": {
            ...gpt,
            models: [luna ?? { id: MODEL, efforts: ["low"], status: "active" }],
          },
        },
      },
    } as ProviderConfig["providers"],
  };
}

/** The final message read as JSON and decoded by the format's own schema. */
function expectDecodes(format: (typeof FORMATS)[number], finalText: string) {
  let parsed: unknown;
  expect(() => {
    parsed = JSON.parse(finalText);
  }, "the final message is JSON").not.toThrow();
  const decoded = Schema.decodeUnknownEither(
    ANSWER_FORMATS[format].schema as Schema.Schema<unknown, unknown>,
    { onExcessProperty: "error" },
  )(parsed);
  expect(Either.isRight(decoded) ? "" : String(decoded.left)).toBe("");
}

describe.skipIf(!shouldRun)("codex --output-schema (real provider)", () => {
  let repoDir: string;

  const layer = makeNodeBackendLayer(providerConfig());
  const run = <A, E>(use: (backend: Backend["Type"]) => Effect.Effect<A, E, never>) =>
    Effect.runPromise(
      Effect.flatMap(Backend, use).pipe(
        Effect.provide(layer),
        Effect.provide(ProviderStoreRootsLive),
      ) as Effect.Effect<A, E, never>,
    );

  beforeAll(() => {
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-codex-output-schema-")));
    spawnSync("git", ["init", "-q"], { cwd: repoDir });
  });

  afterAll(() => {
    if (repoDir) removeTempDir(repoDir);
  });

  const optionsOf = (format: (typeof FORMATS)[number]): AgentRunOptions => ({
    provider: "codex-cli",
    model: MODEL,
    effort: EFFORT,
    cwd: repoDir,
    security: resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath: repoDir,
      config: resolveSecurityConfig(undefined, "secure"),
    }),
    readOnly: true,
    answerSchema: { call: CALL_OF[format], schema: answerJsonSchema(format) },
  });

  for (const format of FORMATS) {
    // `exec` then `exec resume` of that session, both with --output-schema.
    it(`${format}: exec, then exec resume`, { timeout: 2 * TIMEOUT }, async () => {
      const answer = validDocuments[format];
      const options = optionsOf(format);
      const first = await run((backend) => backend.runAgent(askFor(answer), options));
      expectDecodes(format, first.finalText);
      const resumed = await run((backend) =>
        backend.resumeAgentSession(
          first.sessionId as ClaudeSessionId,
          "Answer once more with exactly the same JSON document.",
          options,
        ),
      );
      expectDecodes(format, resumed.finalText);
    });
  }
});
