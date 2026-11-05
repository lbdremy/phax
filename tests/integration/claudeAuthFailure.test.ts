import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Either } from "effect";
import { describe, expect, it, vi } from "vitest";
import { AgentSessionFailedError } from "../../src/domain/errors.js";
import { readClaudeOutcome, type SessionFailure } from "../../src/domain/session/outcome.js";
import { serializeSidecar } from "../../src/domain/artifact/sidecar.js";
import { renderSpecBody } from "../../src/domain/authoring/renderSpec.js";
import type { SpecDocument } from "../../src/schemas/specDocument.js";
import {
  RECORDS_BRANCH,
  RECORDS_ON,
  SPEC_FRONTMATTER,
  expectFailure,
  useDecideRepo,
} from "../helpers/decideVerdictsHarness.js";
import { SESSION, runHeadlessPlan, useFakeClaude } from "../helpers/projectOnlyHarness.js";
import { FILE_VALID, SPEC, SPEC_PATH } from "../unit/decide/verdictsFixtures.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// A Claude Code session refused as not authenticated fails with its own kind,
// worded with the remedies, and is neither paused nor retried. The run goes
// through the real node backend over the recording stub; the decide case
// through the decide harness with the failure read by the real Claude reader.

const REFUSAL = "Invalid API key · Please run /login";

const fake = useFakeClaude();
const world = useDecideRepo();

/** The stream Claude Code prints when it is not authenticated: the refusal as a synthetic message, then an error result. */
const NOT_AUTHENTICATED_STREAM: readonly unknown[] = [
  { type: "system", subtype: "init", session_id: SESSION },
  {
    type: "assistant",
    session_id: SESSION,
    error: "authentication_failed",
    is_api_error_message: true,
    message: { role: "assistant", content: [{ type: "text", text: REFUSAL }] },
  },
  {
    type: "result",
    subtype: "success",
    is_error: true,
    session_id: SESSION,
    result: REFUSAL,
  },
];

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("ac-auth", () => {
  it(
    "a claude-code phase refused as not authenticated fails with the named cause, is not paused or retried, and spawns claude once",
    { timeout: 60_000 },
    async () => {
      fake.cli.setScript({
        sessionId: SESSION,
        finalText: REFUSAL,
        stream: NOT_AUTHENTICATED_STREAM,
        exitCode: 1,
      });

      const { result } = await runHeadlessPlan(fake, {
        phases: [{ id: "phase-01", model: "claude-opus-5-5" }],
        gate: "pass",
        records: false,
      });

      expect(Either.isLeft(result)).toBe(true);
      const error = Either.isLeft(result) ? result.left : undefined;
      expect(error).toBeInstanceOf(AgentSessionFailedError);
      const failed = error as AgentSessionFailedError;
      expect(failed.failure.kind).toBe("not-authenticated");
      expect(failed.message).toContain("Claude Code is not authenticated");
      expect(failed.message).toContain("do not load your Claude Code user settings");
      expect(failed.message).toContain("claude /login");
      expect(failed.message).toContain("ANTHROPIC_API_KEY");
      // Not a network pause: the error names no paused phase.
      expect(failed.phaseId).toBeUndefined();

      // No retry or fix attempt resumed the session.
      expect(fake.claudeLaunches()).toHaveLength(1);
      expect(fake.launches()).toHaveLength(1);

      // Not paused as rate_limited, and no resume instructions written.
      const written = filesUnder(fake.root).filter((path) => !path.includes("/.git/"));
      expect(written.filter((path) => path.endsWith("resume-instructions.md"))).toEqual([]);
      const states = written.filter((path) => /(^|\/)(run|phase)-state\.json$/.test(path));
      for (const path of states) {
        expect(readFileSync(path, "utf8")).not.toContain("rate_limited");
      }
    },
  );

  it("a decide whose handback is refused as not authenticated records failure not-authenticated", async () => {
    const authoringId = "2610250900-log-rotation";
    const doc = SPEC.document as SpecDocument;
    world.writeRepoFile(SPEC_PATH, SPEC_FRONTMATTER + renderSpecBody(doc));
    world.writeRepoFile(SPEC_PATH.replace(/\.md$/, ".json"), serializeSidecar(SPEC));
    world.writeRepoFile("verdicts.json", FILE_VALID);
    world.commitAll();
    world.keepAuthoringSession(authoringId);
    const refused = readClaudeOutcome({
      lines: NOT_AUTHENTICATED_STREAM.map((line) => JSON.stringify(line)),
      stderr: "",
      end: { kind: "exited", code: 1 },
    });
    if (refused.kind !== "failure") throw new Error("the refusal must read as a failure");
    const failure: SessionFailure = refused.failure;
    const h = world.harness();
    h.backend.failNextResumeWith(failure);

    const { error } = expectFailure(
      world,
      await h.run({ records: RECORDS_ON }),
      5,
      world.headSha(),
    );

    expect(error.tag).toBe("AgentSessionFailedError");
    const manifest = JSON.parse(
      world.git(["show", `${RECORDS_BRANCH}:decision/${authoringId}/01/record.json`]),
    ) as Record<string, unknown>;
    expect(manifest).toMatchObject({
      outcome: "failed",
      commit: null,
      failure: "not-authenticated",
    });
  });
});
