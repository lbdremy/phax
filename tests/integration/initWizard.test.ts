import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { runInitWizard } from "../../src/app/initWizard.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { FAKE_PROMPT_CANCEL, makeFakePrompt } from "../../src/infra/fakes/prompt.js";
import { PromptCancelled } from "../../src/ports/prompt.js";
import { decodePhaxConfig } from "../../src/schemas/phaxConfig.js";

const CWD = "/test";
const CONFIG_PATH = "/test/phax.json";
const SCHEMA_PATH = "/test/phax.schema.json";
const USER_SCHEMA_PATH = "/test/phax.user.schema.json";
const PKG_PATH = "/test/package.json";

const PKG_WITH_SCRIPTS = JSON.stringify({
  name: "@org/my-app",
  packageManager: "pnpm@9.0.0",
  scripts: {
    typecheck: "tsc --noEmit",
    lint: "eslint .",
    "test:unit": "vitest run unit",
  },
});

async function runWizard(
  fakeFs: ReturnType<typeof makeFakeFileSystem>,
  fakePrompt: ReturnType<typeof makeFakePrompt>,
  opts: { force?: boolean; interactive: boolean },
) {
  return Effect.runPromise(
    Effect.either(
      runInitWizard({ cwd: CWD, ...opts }).pipe(
        Effect.provide(Layer.mergeAll(fakeFs.layer, fakePrompt.layer)),
      ),
    ),
  );
}

describe("runInitWizard — non-interactive path", () => {
  it("creates phax.json with detected name and recommended gate commands", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([]);

    const result = await runWizard(fakeFs, fakePrompt, { interactive: false });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("created");
    if (result.right.kind !== "created") return;

    const written = fakeFs.impl.getFile(CONFIG_PATH);
    expect(written).toBeDefined();
    const config = JSON.parse(written!);
    expect(config.name).toBe("my-app");
    expect(config.gateProfiles?.fast).toContain("pnpm typecheck");
    expect(config.gateProfiles?.fast).toContain("pnpm lint");
    expect(config.gateProfiles?.fast).toContain("pnpm test:unit");
  });

  it("does not write a state block", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([]);

    const result = await runWizard(fakeFs, fakePrompt, { interactive: false });
    expect(Either.isRight(result)).toBe(true);

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.state).toBeUndefined();
  });

  it("does not enable compliance or publish by default", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([]);

    await runWizard(fakeFs, fakePrompt, { interactive: false });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.review).toBeUndefined();
    expect(config.publish).toBeUndefined();
  });

  it("writes both phax.schema.json and phax.user.schema.json", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([]);

    await runWizard(fakeFs, fakePrompt, { interactive: false });

    expect(fakeFs.impl.getFile(SCHEMA_PATH)).toBeDefined();
    expect(fakeFs.impl.getFile(USER_SCHEMA_PATH)).toBeDefined();
  });

  it("written phax.json decodes cleanly through decodePhaxConfig", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([]);

    await runWizard(fakeFs, fakePrompt, { interactive: false });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    const decoded = decodePhaxConfig(config);
    expect(Either.isRight(decoded)).toBe(true);
  });

  it("uses cwd basename as name when package.json is absent", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakePrompt = makeFakePrompt([]);

    await runWizard(fakeFs, fakePrompt, { interactive: false });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.name).toBe("test");
  });

  it("falls back to placeholder when no scripts present", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, JSON.stringify({ name: "bare-pkg" }));
    const fakePrompt = makeFakePrompt([]);

    await runWizard(fakeFs, fakePrompt, { interactive: false });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.gateProfiles?.fast).toEqual([
      "echo 'replace with your gate commands in phax.json'",
    ]);
  });

  it("returns already_initialized when phax.json exists and no force", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(CONFIG_PATH, JSON.stringify({ sentinel: true }));
    const fakePrompt = makeFakePrompt([]);

    const result = await runWizard(fakeFs, fakePrompt, { interactive: false });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("already_initialized");
    // file must not be overwritten
    expect(JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!)).toEqual({ sentinel: true });
  });

  it("overwrites existing phax.json when force is true", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(CONFIG_PATH, JSON.stringify({ sentinel: true }));
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([]);

    const result = await runWizard(fakeFs, fakePrompt, { force: true, interactive: false });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("created");
    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.version).toBe(1);
  });
});

describe("runInitWizard — interactive path", () => {
  it("prompts for name and gate commands, writes config with user answers", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    // Queue: name, multiselect commands, compliance, publish
    const fakePrompt = makeFakePrompt([
      "my-lib",
      ["pnpm typecheck"],
      false, // compliance
      false, // publish
    ]);

    const result = await runWizard(fakeFs, fakePrompt, { interactive: true });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("created");

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.name).toBe("my-lib");
    expect(config.gateProfiles?.fast).toEqual(["pnpm typecheck"]);
    expect(config.review).toBeUndefined();
    expect(config.publish).toBeUndefined();
  });

  it("enables compliance when user toggles it on", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([
      "my-lib",
      ["pnpm typecheck"],
      true, // compliance enabled
      false, // publish
    ]);

    await runWizard(fakeFs, fakePrompt, { interactive: true });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.review?.compliance?.enabled).toBe(true);
  });

  it("enables publish with push/PR settings when user toggles it on", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([
      "my-lib",
      ["pnpm typecheck"],
      false, // compliance
      true, // publish
      true, // push branch
      false, // create PR
    ]);

    await runWizard(fakeFs, fakePrompt, { interactive: true });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.publish?.enabled).toBe(true);
    expect(config.publish?.pushBranch).toBe(true);
    expect(config.publish?.createPullRequest).toBe(false);
  });

  it("uses a text prompt for gate command when no scripts are detected", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, JSON.stringify({ name: "bare-pkg" }));
    const fakePrompt = makeFakePrompt([
      "bare-pkg", // name
      "pnpm run test", // gate command text prompt (no scripts)
      false, // compliance
      false, // publish
    ]);

    await runWizard(fakeFs, fakePrompt, { interactive: true });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.gateProfiles?.fast).toEqual(["pnpm run test"]);
  });

  it("does not write a state block in interactive mode", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt(["my-lib", ["pnpm typecheck"], false, false]);

    await runWizard(fakeFs, fakePrompt, { interactive: true });

    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.state).toBeUndefined();
  });

  it("writes both schema files in interactive mode", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt(["my-lib", ["pnpm typecheck"], false, false]);

    await runWizard(fakeFs, fakePrompt, { interactive: true });

    expect(fakeFs.impl.getFile(SCHEMA_PATH)).toBeDefined();
    expect(fakeFs.impl.getFile(USER_SCHEMA_PATH)).toBeDefined();
  });
});

describe("runInitWizard — cancel", () => {
  it("surfaces PromptCancelled when user cancels the name prompt", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([FAKE_PROMPT_CANCEL]);

    const result = await runWizard(fakeFs, fakePrompt, { interactive: true });

    expect(Either.isLeft(result)).toBe(true);
    if (!Either.isLeft(result)) return;
    expect(result.left).toBeInstanceOf(PromptCancelled);
  });

  it("writes nothing to disk when cancelled", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    const fakePrompt = makeFakePrompt([FAKE_PROMPT_CANCEL]);

    await runWizard(fakeFs, fakePrompt, { interactive: true });

    expect(fakeFs.impl.getFile(CONFIG_PATH)).toBeUndefined();
    expect(fakeFs.impl.getFile(SCHEMA_PATH)).toBeUndefined();
    expect(fakeFs.impl.getFile(USER_SCHEMA_PATH)).toBeUndefined();
  });
});

describe("runInitWizard — existing config, interactive reconfigure", () => {
  it("returns already_initialized when user declines reconfiguration", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      CONFIG_PATH,
      JSON.stringify({ version: 1, name: "old-name", gateProfiles: { fast: ["pnpm test"] } }),
    );
    const fakePrompt = makeFakePrompt([false]); // confirm(reconfigure) = false

    const result = await runWizard(fakeFs, fakePrompt, { interactive: true });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("already_initialized");
  });

  it("uses existing name as default when user confirms reconfiguration", async () => {
    const fakeFs = makeFakeFileSystem();
    fakeFs.impl.setFile(
      CONFIG_PATH,
      JSON.stringify({
        $schema: "./phax.schema.json",
        version: 1,
        name: "old-name",
        gateProfiles: { fast: ["pnpm test"] },
      }),
    );
    fakeFs.impl.setFile(PKG_PATH, PKG_WITH_SCRIPTS);
    // Queue: confirm(reconfigure)=true, name prompt shows "old-name" as default
    // We answer with a new name to prove default was passed through
    const fakePrompt = makeFakePrompt([
      true, // reconfigure
      "new-name", // name (overriding old-name default)
      ["pnpm typecheck"],
      false, // compliance
      false, // publish
    ]);

    const result = await runWizard(fakeFs, fakePrompt, { interactive: true });

    expect(Either.isRight(result)).toBe(true);
    if (!Either.isRight(result)) return;
    expect(result.right.kind).toBe("created");
    const config = JSON.parse(fakeFs.impl.getFile(CONFIG_PATH)!);
    expect(config.name).toBe("new-name");
  });
});
