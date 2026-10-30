import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Either, Schema } from "effect";
import { Backend, type AgentRunOptions } from "../../src/ports/backend.js";
import type { ClaudeSessionId } from "../../src/domain/branded.js";
import { resolveReviewSecurityPolicy } from "../../src/domain/security/resolveReviewPolicy.js";
import { readClaudeOutcome } from "../../src/domain/session/outcome.js";
import type { StructuredCallId } from "../../src/domain/session/structuredCalls.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { ProviderStoreRootsLive } from "../../src/infra/providerStoreRoots.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import {
  ANSWER_FORMATS,
  answerJsonSchema,
  type AnswerFormatId,
} from "../../src/schemas/answerSchemas.js";
import { resolveSecurityConfig } from "../../src/schemas/securityConfig.js";
import { validDocuments } from "../unit/schemasPackage/documents.js";
import { removeTempDir } from "../helpers/tempGit.js";
import { probeProvider } from "./helpers/providers.js";

// Smoke test of Claude Code's `--json-schema` through phax's real Claude
// adapter: each of the eight answer schemas, on a new session and on a
// `--resume` of it, with the call's own options (read-only tools and
// stream-json; the extraction format through `complete`, which has no
// session). The result must carry a `structured_output` that phax's decoder
// accepts once the adapter has set the format's `$schema` stamp.
//
// Target versions: Claude Code 2.1.314, codex-cli 0.165.0.
//
// Neither the phase gate nor a phase agent runs this file (it hits the real
// CLI and needs PHAX_E2E_RUN=1); the PR review runs it by name:
//
//   PHAX_E2E_RUN=1 pnpm test:e2e:real tests/e2e/claudeJsonSchema.test.ts
//
// What a failure asks for depends on where it is:
// - A Claude Code combination fails (the `--resume`, the read-only tools or
//   stream-json): flip that call's line in STRUCTURED_CALLS
//   (src/domain/session/structuredCalls.ts) to "prompt", along with its row
//   of docs/structured-answers.md. The tests follow the table.
// - A schema construct is refused (the new session fails on the schema
//   itself): that rule becomes a coherence check for both providers (spec
//   §10), never a flip and never a provider-only schema.
const shouldRun = process.env["PHAX_E2E_RUN"] === "1" && probeProvider("claude");

const MODEL = "claude-haiku-5-5";
const EFFORT = "low";
const TIMEOUT = 300_000;

/** The call that hands each answer format (spec §10: once per schema). */
const CALL_OF: Readonly<Record<AnswerFormatId, StructuredCallId>> = {
  "spec-document": "authoring",
  "plan-document": "authoring",
  "spec-hand-decision-answer": "decide-handback",
  "plan-hand-decision-answer": "decide-handback",
  "first-reading": "first-turn",
  "interactive-handoff": "closing-turn",
  "code-review": "code-review",
  "phax-plan-extraction": "plan-extraction",
};

/**
 * The minimal valid answer of each format, as the published sidecar or answer
 * document. The extraction answer is the smallest one: no plan, a reason.
 */
function fixtureOf(format: AnswerFormatId): unknown {
  if (format === "phax-plan-extraction") {
    return {
      $schema: (validDocuments[format] as { $schema: string }).$schema,
      plan: null,
      incomplete: "The plan has no phases.",
    };
  }
  return validDocuments[format];
}

const askFor = (answer: unknown): string =>
  [
    "This is a smoke test of structured output. Do not read or change any file.",
    "Answer with exactly this JSON document, with every value as given:",
    JSON.stringify(answer),
  ].join("\n\n");

function expectDecodes(format: AnswerFormatId, structured: { readonly value: unknown } | null) {
  expect(structured, "the result carries structured_output").not.toBeNull();
  const decoded = Schema.decodeUnknownEither(
    ANSWER_FORMATS[format].schema as Schema.Schema<unknown, unknown>,
    { onExcessProperty: "error" },
  )(structured?.value);
  expect(Either.isRight(decoded) ? "" : String(decoded.left)).toBe("");
}

function expectBounds(structured: { readonly value: unknown } | null) {
  const value = structured?.value as { items?: unknown[]; amount?: number } | undefined;
  expect(value, "the result carries structured_output").toBeDefined();
  expect(value?.items?.length).toBeGreaterThanOrEqual(2);
  expect(value?.amount).toBeGreaterThan(0);
}

describe.skipIf(!shouldRun)("claude-code --json-schema (real provider)", () => {
  let repoDir: string;

  const layer = makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG);
  const run = <A, E>(use: (backend: Backend["Type"]) => Effect.Effect<A, E, never>) =>
    Effect.runPromise(
      Effect.flatMap(Backend, use).pipe(
        Effect.provide(layer),
        Effect.provide(ProviderStoreRootsLive),
      ) as Effect.Effect<A, E, never>,
    );

  beforeAll(() => {
    repoDir = realpathSync(mkdtempSync(join(tmpdir(), "phax-claude-json-schema-")));
    spawnSync("git", ["init", "-q"], { cwd: repoDir });
  });

  afterAll(() => {
    if (repoDir) removeTempDir(repoDir);
  });

  /** The options of a call's session: read-only, with the review policy, and the schema. */
  const optionsOf = (call: StructuredCallId, schema: object): AgentRunOptions => ({
    provider: "claude-code",
    model: MODEL,
    effort: EFFORT,
    cwd: repoDir,
    security: resolveReviewSecurityPolicy({
      mode: "secure",
      worktreePath: repoDir,
      config: resolveSecurityConfig(undefined, "secure"),
    }),
    readOnly: true,
    answerSchema: { call, schema },
  });

  for (const format of Object.keys(ANSWER_FORMATS) as AnswerFormatId[]) {
    const call = CALL_OF[format];
    const schema = answerJsonSchema(format);
    const answer = fixtureOf(format);
    if (format === "phax-plan-extraction") {
      // `complete` is the extraction's call: sealed flags, no tools, no session.
      it(`${format}: new session`, { timeout: TIMEOUT }, async () => {
        const result = await run((backend) =>
          backend.complete(askFor(answer), {
            provider: "claude-code",
            model: MODEL,
            effort: EFFORT,
            cwd: repoDir,
            answerSchema: { call, schema },
          }),
        );
        expectDecodes(format, result.structured);
      });
      continue;
    }

    it(`${format}: new session`, { timeout: TIMEOUT }, async () => {
      const result = await run((backend) =>
        backend.runAgent(askFor(answer), optionsOf(call, schema)),
      );
      expectDecodes(format, result.structured);
    });

    // A closing turn and a decide handback resume a person's session; here the
    // resumed session is a headless one, which exercises the same argv.
    it(`${format}: resume`, { timeout: 2 * TIMEOUT }, async () => {
      const options = optionsOf(call, schema);
      const first = await run((backend) => backend.runAgent(askFor(answer), options));
      const resumed = await run((backend) =>
        backend.resumeAgentSession(
          first.sessionId as ClaudeSessionId,
          `Answer once more with exactly the same JSON document.`,
          options,
        ),
      );
      expectDecodes(format, resumed.structured);
    });
  }

  // Regression guard: the 2026-10-30 probe found `--json-schema` accepts and
  // enforces `minItems` and `exclusiveMinimum`, so the answer schemas keep both.
  describe("minItems and exclusiveMinimum probe", () => {
    const probe = {
      type: "object",
      additionalProperties: false,
      required: ["items", "amount"],
      properties: {
        items: { type: "array", minItems: 2, items: { type: "string" } },
        amount: { type: "number", exclusiveMinimum: 0 },
      },
    } as const;
    const ask =
      "Answer with an object holding two or more strings in `items` and a number greater than zero in `amount`.";

    it("new session", { timeout: TIMEOUT }, async () => {
      const result = await run((backend) => backend.runAgent(ask, optionsOf("authoring", probe)));
      expectBounds(result.structured);
    });

    it("resume", { timeout: 2 * TIMEOUT }, async () => {
      const options = optionsOf("authoring", probe);
      const first = await run((backend) => backend.runAgent(ask, options));
      const resumed = await run((backend) =>
        backend.resumeAgentSession(first.sessionId as ClaudeSessionId, ask, options),
      );
      expectBounds(resumed.structured);
    });
  });

  // Regression guard: a root `$schema` property is refused by the API (a 400)
  // before any model turn, which is why the adapter hands Claude Code the
  // schema without it. Handed to the real CLI as is, bypassing
  // claudeAnswerSchema, phax reads the session as a provider-error.
  it(
    "refuses a schema carrying a $schema property, as a provider-error",
    { timeout: 120_000 },
    () => {
      const withStamp = {
        type: "object",
        additionalProperties: false,
        required: ["$schema", "value"],
        properties: {
          $schema: { type: "string", const: "https://example.test/answer.json" },
          value: { type: "string" },
        },
      };
      const spawned = spawnSync(
        "claude",
        [
          "-p",
          "--output-format",
          "stream-json",
          "--verbose",
          "--json-schema",
          JSON.stringify(withStamp),
          "--model",
          MODEL,
        ],
        { cwd: repoDir, input: "Answer with any value.", encoding: "utf8", timeout: 110_000 },
      );
      const outcome = readClaudeOutcome({
        lines: spawned.stdout.split("\n").filter((line) => line.trim() !== ""),
        stderr: spawned.stderr,
        end: { kind: "exited", code: spawned.status ?? 1 },
      });
      expect(outcome.kind).toBe("failure");
      if (outcome.kind !== "failure") return;
      expect(outcome.failure.kind).toBe("provider-error");
      expect(outcome.failure.message).toContain("Property keys should match pattern");
    },
  );
});
