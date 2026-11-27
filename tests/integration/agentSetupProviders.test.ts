import { Effect, Result, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { providerSetup } from "../../src/app/providerSetup.js";
import { resolvePhaxHome } from "../../src/app/phaxHome.js";
import { phaxHomeFile } from "../../src/domain/phaxHome.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import type { ProviderConfig } from "../../src/schemas/providerConfig.js";

// The phax home's files, resolved at call time like phax resolves them.
const providersPath = (): string =>
  phaxHomeFile(Result.getOrThrow(resolvePhaxHome()), "providers.json");
const routingPath = (): string =>
  phaxHomeFile(Result.getOrThrow(resolvePhaxHome()), "model-routing.json");

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
      Effect.result(providerSetup({ write: false, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const { plan, written, backupPath } = Result.getOrThrow(result);

    expect(plan.enabled).toContain("mistral-vibe");
    expect(written).toBe(false);
    expect(backupPath).toBeUndefined();
    expect(fakeFs.impl.getFile(providersPath())).toBeUndefined();
  });

  it("--write produces providers.json with expected enabled flags", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    setupProbes(fakeShell.impl, { claude: true, vibe: true, codex: false });

    const result = await Effect.runPromise(
      Effect.result(providerSetup({ write: true, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);

    const rawFile = fakeFs.impl.getFile(providersPath());
    expect(rawFile).toBeDefined();
    const parsed = JSON.parse(rawFile!) as {
      providers: Record<string, { enabled: boolean }>;
    };
    expect(parsed.providers["claude-code"]!.enabled).toBe(true);
    expect(parsed.providers["mistral-vibe"]!.enabled).toBe(true);
    expect(parsed.providers["codex-cli"]!.enabled).toBe(false);
  });

  it("--write over a providers.json that disables codex-cli keeps it disabled while codex is installed", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    setupProbes(fakeShell.impl, { claude: true, vibe: false, codex: true });

    const existing: ProviderConfig = {
      providers: Object.fromEntries(
        Object.entries(DEFAULT_PROVIDER_CONFIG.providers).map(([key, entry]) => [
          key,
          key === "codex-cli" ? { ...entry, enabled: false } : entry,
        ]),
      ),
    };
    fakeFs.impl.setFile(providersPath(), JSON.stringify(existing, null, 2));

    const result = await Effect.runPromise(
      Effect.result(providerSetup({ write: true, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const { plan } = Result.getOrThrow(result);
    expect(plan.enabled).toEqual([]);
    expect(plan.disabled).toEqual([]);
    expect(plan.unchanged).toContain("codex-cli");

    const written: unknown = JSON.parse(fakeFs.impl.getFile(providersPath()) ?? "null");
    expect(written).toMatchObject({ providers: { "codex-cli": { enabled: false } } });
    expect(written).toEqual(existing);
  });

  it("--write over a providers.json listing a subset of models writes back exactly that subset, retired ids replaced", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    setupProbes(fakeShell.impl, { claude: true, vibe: true, codex: true });

    const opus = { id: "claude-opus-5-5", efforts: ["low", "high"], status: "active" } as const;
    const gpt = { id: "gpt-5.5", efforts: ["low", "medium"], status: "active" } as const;
    const existing: ProviderConfig = {
      providers: {
        "claude-code": {
          enabled: true,
          executable: "claude",
          families: { "claude-opus": { models: [opus] } },
        },
        "mistral-vibe": {
          enabled: true,
          executable: "vibe",
          defaultAgent: "auto-approve",
          families: {
            "mistral-medium": {
              models: [
                { id: "phax-mistral-medium-3.5-off", efforts: ["none"], status: "active" },
                { id: "phax-mistral-medium-3.5-high", efforts: ["high"], status: "active" },
              ],
            },
          },
        },
        "codex-cli": {
          enabled: false,
          executable: "codex",
          families: { "openai-gpt": { models: [gpt] } },
        },
      },
    };
    fakeFs.impl.setFile(providersPath(), JSON.stringify(existing, null, 2));

    const result = await Effect.runPromise(
      Effect.result(providerSetup({ write: true, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const { plan } = Result.getOrThrow(result);
    expect(plan.retiredRemoved).toEqual([
      "phax-mistral-medium-3.5-off",
      "phax-mistral-medium-3.5-high",
    ]);
    expect(plan.retiredReplaced).toEqual(["mistral-medium-3.5"]);

    const written: unknown = JSON.parse(fakeFs.impl.getFile(providersPath()) ?? "null");
    expect(written).toEqual({
      providers: {
        "claude-code": existing.providers["claude-code"],
        "mistral-vibe": {
          ...existing.providers["mistral-vibe"],
          families: {
            "mistral-medium": {
              models: [{ id: "mistral-medium-3.5", efforts: ["off", "high"], status: "active" }],
            },
          },
        },
        "codex-cli": existing.providers["codex-cli"],
      },
    });
  });

  it("--prune disables an enabled provider whose probe is unavailable", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    setupProbes(fakeShell.impl, { claude: false, vibe: false, codex: false });

    const result = await Effect.runPromise(
      Effect.result(providerSetup({ write: true, prune: true, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const { plan } = Result.getOrThrow(result);

    expect(plan.disabled).toContain("claude-code");

    const rawFile = fakeFs.impl.getFile(providersPath());
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
      Effect.result(providerSetup({ write: true, prune: false, withRouting: true })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const { routingScaffolded } = Result.getOrThrow(result);
    expect(routingScaffolded).toBe(true);
    expect(fakeFs.impl.getFile(routingPath())).toBeDefined();
  });

  it("--with-routing does not overwrite an existing model-routing.json", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "1.0", stderr: "" });

    const existingRouting = JSON.stringify({ version: 1, custom: true });
    fakeFs.impl.setFile(routingPath(), existingRouting);

    const result = await Effect.runPromise(
      Effect.result(providerSetup({ write: true, prune: false, withRouting: true })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const { routingScaffolded } = Result.getOrThrow(result);
    expect(routingScaffolded).toBe(false);
    expect(fakeFs.impl.getFile(routingPath())).toBe(existingRouting);
  });

  it("backup is written when overwriting an existing providers.json", async () => {
    const fakeFs = makeFakeFileSystem();
    const fakeShell = makeFakeShell();
    fakeShell.impl.setDefaultResponse({ exitCode: 0, stdout: "1.0", stderr: "" });

    const existingContent = JSON.stringify(DEFAULT_PROVIDER_CONFIG, null, 2);
    fakeFs.impl.setFile(providersPath(), existingContent);

    const result = await Effect.runPromise(
      Effect.result(providerSetup({ write: true, prune: false, withRouting: false })).pipe(
        Effect.provide(makeLayer(fakeFs, fakeShell)),
      ),
    );

    expect(Result.isSuccess(result)).toBe(true);
    const { backupPath } = Result.getOrThrow(result);
    expect(backupPath).toBeDefined();
    expect(backupPath!.startsWith(`${providersPath()}.phax-backup-`)).toBe(true);
    expect(fakeFs.impl.getFile(backupPath!)).toBe(existingContent);
  });
});
