import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Either, Layer } from "effect";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeGit } from "../../src/infra/fakes/git.js";
import { makeFakeGitHub } from "../../src/infra/fakes/github.js";
import { FAKE_PROMPT_CANCEL, makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import type { GitError } from "../../src/ports/git.js";
import type { FsError } from "../../src/ports/fs.js";
import type { GitHubError } from "../../src/ports/github.js";
import { PromptCancelled, type PromptError } from "../../src/ports/prompt.js";
import { configureRecords, type ConfigureRecordsResult } from "../../src/app/configureRecords.js";

describe("configureRecords", () => {
  let repoRoot: string;
  let stateRoot: string;
  let configPath: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), "phax-records-init-repo-"));
    stateRoot = mkdtempSync(join(tmpdir(), "phax-records-init-state-"));
    configPath = join(repoRoot, "phax.json");
  });

  afterEach(async () => {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(stateRoot, { recursive: true, force: true });
  });

  async function writeConfig(extra: Record<string, unknown> = {}): Promise<void> {
    await writeFile(
      configPath,
      JSON.stringify(
        {
          version: 1,
          name: "acme",
          gateProfiles: {
            fast: [{ command: "pnpm test", surface: "local", firing: "every-phase" }],
          },
          ...extra,
        },
        null,
        2,
      ),
    );
  }

  function run(
    fakePrompt: ReturnType<typeof makeFakePrompt>,
    visibility: "public" | "private" | "unknown",
    opts: { force?: boolean } = {},
  ): Promise<
    Either.Either<
      ConfigureRecordsResult,
      FsError | GitError | GitHubError | PromptError | PromptCancelled
    >
  > {
    const fakeGitHub = makeFakeGitHub();
    fakeGitHub.impl.setVisibility(visibility);
    const fakeGit = makeFakeGit();
    const layer = Layer.mergeAll(
      NodeFileSystemLayer,
      fakeGit.layer,
      fakeGitHub.layer,
      fakePrompt.layer,
    );
    return Effect.runPromise(
      Effect.either(
        configureRecords({
          configPath,
          repoRoot,
          stateRoot,
          namespace: "acme",
          ...opts,
        }).pipe(Effect.provide(layer)),
      ),
    );
  }

  it("configures a skeleton record (transcript off) even though the user answered no", async () => {
    await writeConfig();
    const fakePrompt = makeFakePrompt([
      false, // transcript
      true, // autoPush
    ]);

    const result = await run(fakePrompt, "private");

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("configured");
    if (result.right.kind !== "configured") return;
    expect(result.right.records.transcript).toBe(false);
    expect(result.right.records.destination).toEqual({ kind: "in-repo" });

    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.records.transcript).toBe(false);
  });

  it("a public source repo with transcripts on demands a remote and never offers in-repo", async () => {
    await writeConfig();
    const fakePrompt = makeFakePrompt([
      true, // transcript
      "https://example.com/records.git", // remote
      true, // autoPush
    ]);

    const result = await run(fakePrompt, "public");

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("configured");
    if (result.right.kind !== "configured") return;
    expect(result.right.records.destination).toEqual({
      kind: "repo",
      remote: "https://example.com/records.git",
    });
    expect(fakePrompt.impl.asks.some((a) => a.toLowerCase().includes("remote"))).toBe(true);
  });

  it("an in-repo destination with transcripts on emits the public-later disclosure", async () => {
    await writeConfig();
    const fakePrompt = makeFakePrompt([
      true, // transcript
      true, // autoPush
    ]);

    const result = await run(fakePrompt, "private");

    expect(Either.isRight(result)).toBe(true);
    expect(fakePrompt.impl.asks.some((a) => a.toLowerCase().includes("public"))).toBe(true);
  });

  it("refuses on an already-configured project, and --force reconfigures", async () => {
    await writeConfig({
      records: { transcript: false, destination: { kind: "in-repo" }, autoPush: false },
    });
    const fakePrompt = makeFakePrompt([]);

    const refused = await run(fakePrompt, "private");
    expect(Either.isRight(refused)).toBe(true);
    if (!Either.isRight(refused)) return;
    expect(refused.right.kind).toBe("already_configured");
    expect(fakePrompt.impl.asks).toEqual([]);

    const forcedPrompt = makeFakePrompt([true, true]);
    const forced = await run(forcedPrompt, "private", { force: true });
    expect(Either.isRight(forced)).toBe(true);
    if (!Either.isRight(forced)) return;
    expect(forced.right.kind).toBe("configured");
  });

  it("a rejected remote URL fails before anything is written", async () => {
    await writeConfig();
    const fakePrompt = makeFakePrompt([
      true, // transcript
      "ext::sh -c 'echo pwned'", // invalid remote — rejected by validate()
    ]);

    const result = await run(fakePrompt, "public");

    expect(Either.isLeft(result)).toBe(true);
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.records).toBeUndefined();
  });

  it("surfaces cancellation and writes nothing", async () => {
    await writeConfig();
    const fakePrompt = makeFakePrompt([FAKE_PROMPT_CANCEL]);

    const result = await run(fakePrompt, "private");

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left).toBeInstanceOf(PromptCancelled);
    const written = JSON.parse(await readFile(configPath, "utf8"));
    expect(written.records).toBeUndefined();
  });
});
