import { Effect, Either, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { providerSetup } from "../../src/app/providerSetup.js";
import { PROVIDER_CONFIG_PATH, MODEL_ROUTING_PATH } from "../../src/app/loadRouting.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";

function makeLayer(
  fakeFs: ReturnType<typeof makeFakeFileSystem>,
  fakeShell: ReturnType<typeof makeFakeShell>,
) {
  return Layer.mergeAll(fakeFs.layer, fakeShell.layer);
}

function setupProbes(
  shell: ReturnType<typeof makeFakeShell>["impl"],
  probes: Record<string, boolean>,
) {
  for (const [executable, available] of Object.entries(probes)) {
    shell.setResponse(`${executable} --version`, {
      exitCode: available ? 0 : 1,
      stdout: available ? `${executable} 1.0.0` : "",
      stderr: "",
    });
  }
}

describe("providerSetup integration", () => {
  it("dry-run reports plan but writes nothing", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    setupProbes(fakeShell.impl, { claude: true, vibe: true, codex: false });

    const result = await Effect.runPromise(
      Effect.either(providerSetup({ write: false, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    const { plan, written, backupPath } = Either.getOrThrow(result);

    expect(plan.enabled).toContain("mistral-vibe");
    expect(written).toBe(false);
    expect(backupPath).toBeUndefined();
    expect(fakeFs.impl.getFile(PROVIDER_CONFIG_PATH)).toBeUndefined();
  });

  it("--write produces providers.json with expected enabled flags", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    setupProbes(fakeShell.impl, { claude: true, vibe: true, codex: false });

    const result = await Effect.runPromise(
      Effect.either(providerSetup({ write: true, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);

    const rawFile = fakeFs.impl.getFile(PROVIDER_CONFIG_PATH);
    expect(rawFile).toBeDefined();
    const parsed = JSON.parse(rawFile!) as {
      providers: Record<string, { enabled: boolean }>;
    };
    expect(parsed.providers["claude-code"]!.enabled).toBe(true);
    expect(parsed.providers["mistral-vibe"]!.enabled).toBe(true);
    expect(parsed.providers["codex-cli"]!.enabled).toBe(false);
  });

  it("--prune disables an enabled provider whose probe is unavailable", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    setupProbes(fakeShell.impl, { claude: false, vibe: false, codex: false });

    const result = await Effect.runPromise(
      Effect.either(providerSetup({ write: true, prune: true, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    const { plan } = Either.getOrThrow(result);

    expect(plan.disabled).toContain("claude-code");

    const rawFile = fakeFs.impl.getFile(PROVIDER_CONFIG_PATH);
    expect(rawFile).toBeDefined();
    const parsed = JSON.parse(rawFile!) as {
      providers: Record<string, { enabled: boolean }>;
    };
    expect(parsed.providers["claude-code"]!.enabled).toBe(false);
  });

  it("--with-routing writes model-routing.json when absent", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "1.0", stderr: "" });

    const result = await Effect.runPromise(
      Effect.either(providerSetup({ write: true, prune: false, withRouting: true })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    const { routingScaffolded } = Either.getOrThrow(result);
    expect(routingScaffolded).toBe(true);
    expect(fakeFs.impl.getFile(MODEL_ROUTING_PATH)).toBeDefined();
  });

  it("--with-routing does not overwrite an existing model-routing.json", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "1.0", stderr: "" });

    const existingRouting = JSON.stringify({ version: 1, custom: true });
    fakeFs.impl.setFile(MODEL_ROUTING_PATH, existingRouting);

    const result = await Effect.runPromise(
      Effect.either(providerSetup({ write: true, prune: false, withRouting: true })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    const { routingScaffolded } = Either.getOrThrow(result);
    expect(routingScaffolded).toBe(false);
    expect(fakeFs.impl.getFile(MODEL_ROUTING_PATH)).toBe(existingRouting);
  });

  it("backup is written when overwriting an existing providers.json", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "1.0", stderr: "" });

    const existingContent = JSON.stringify(DEFAULT_PROVIDER_CONFIG, null, 2);
    fakeFs.impl.setFile(PROVIDER_CONFIG_PATH, existingContent);

    const result = await Effect.runPromise(
      Effect.either(providerSetup({ write: true, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Either.isRight(result)).toBe(true);
    const { backupPath } = Either.getOrThrow(result);
    expect(backupPath).toBeDefined();
    expect(backupPath!.startsWith(`${PROVIDER_CONFIG_PATH}.phax-backup-`)).toBe(true);
    expect(fakeFs.impl.getFile(backupPath!)).toBe(existingContent);
  });
});
