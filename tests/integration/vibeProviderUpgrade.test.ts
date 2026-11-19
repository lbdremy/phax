import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import * as Effect from "effect/Effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadModelRouting,
  loadProviderConfig,
  MODEL_ROUTING_PATH,
  PROVIDER_CONFIG_PATH,
} from "../../src/app/loadRouting.js";
import { makeAgentGroup } from "../../src/cli/definitions/agent.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { runnerCall } from "../helpers/runnerCall.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// Pre-upgrade providers.json and model-routing.json, through the loaders and `agent setup
// providers`, over a real file system rooted in the temporary PHAX home and a fake Shell.
//   ac-env-refused, ac-successor, ac-one-command and ac-routing-file.
// Only names are asserted (the field path, the ids, the command): the sentences are open.

const RETIRED_OFF = "phax-mistral-medium-3.5-off";
const RETIRED_HIGH = "phax-mistral-medium-3.5-high";
const SUCCESSOR = "mistral-medium-3.5";

const BEFORE_VIBE = {
  enabled: true,
  executable: "vibe",
  modelEnvVar: "VIBE_ACTIVE_MODEL",
  defaultAgent: "auto-approve",
  families: {
    "mistral-medium": {
      models: [
        { id: RETIRED_OFF, efforts: ["off"], status: "active" },
        { id: RETIRED_HIGH, efforts: ["high"], status: "active" },
      ],
    },
  },
};

const AFTER_VIBE = {
  enabled: true,
  executable: "vibe",
  defaultAgent: "auto-approve",
  families: {
    "mistral-medium": {
      models: [{ id: SUCCESSOR, efforts: ["off", "high"], status: "active" }],
    },
  },
};

/** A providers.json holding `claude-code` from the defaults and the given mistral-vibe entry. */
function writeProviders(vibe: object): void {
  const file = {
    providers: {
      "claude-code": DEFAULT_PROVIDER_CONFIG.providers["claude-code"],
      "mistral-vibe": vibe,
    },
  };
  writeFileSync(PROVIDER_CONFIG_PATH, `${JSON.stringify(file, null, 2)}\n`);
}

function readProviders(): { providers: Record<string, Record<string, unknown>> } {
  return JSON.parse(readFileSync(PROVIDER_CONFIG_PATH, "utf8")) as {
    providers: Record<string, Record<string, unknown>>;
  };
}

/** The group over a fake Shell that finds claude and vibe, and not codex. */
function group() {
  const shell = makeFakeShell();
  for (const [executable, available] of [
    ["claude", true],
    ["vibe", true],
    ["codex", false],
  ] as const) {
    shell.impl.setResponse(`${executable} --version`, {
      exitCode: available ? 0 : 1,
      stdout: "",
      stderr: "",
    });
  }
  return makeAgentGroup({ shell: shell.layer, fileSystem: NodeFileSystemLayer });
}

function call(argv: ReadonlyArray<string>) {
  return runnerCall([group()], ["agent", ...argv]);
}

function removeBackups(path: string): void {
  const dir = dirname(path);
  for (const name of readdirSync(dir)) {
    if (name.includes(".phax-backup-")) rmSync(`${dir}/${name}`);
  }
}

beforeEach(() => {
  for (const path of [PROVIDER_CONFIG_PATH, MODEL_ROUTING_PATH]) {
    rmSync(path, { force: true });
    mkdirSync(dirname(path), { recursive: true });
    removeBackups(path);
  }
});

describe("pre-upgrade providers.json", () => {
  it("ac-env-refused: a modelEnvVar field is refused by its path and the fix", async () => {
    writeProviders({ ...AFTER_VIBE, modelEnvVar: "VIBE_ACTIVE_MODEL" });
    const error = await Effect.runPromise(
      Effect.flip(loadProviderConfig().pipe(Effect.provide(NodeFileSystemLayer))),
    );
    expect(error.message).toContain("providers.mistral-vibe.modelEnvVar");
    expect(error.message).toContain("phax agent setup providers --write");
  });

  it("ac-successor: --write lists mistral-medium-3.5 in place of the alias ids", async () => {
    const { modelEnvVar: _dropped, ...withoutEnvVar } = BEFORE_VIBE;
    writeProviders(withoutEnvVar);
    const result = await call(["setup", "providers", "--write"]);
    expect(result.code).toBe(0);

    const vibe = readProviders().providers["mistral-vibe"] as {
      families: Record<string, { models: unknown }>;
    };
    expect(vibe.families["mistral-medium"]?.models).toEqual([
      { id: SUCCESSOR, efforts: ["off", "high"], status: "active" },
    ]);

    const text = `${result.out}\n${result.errLines.join("\n")}`;
    expect(text).toContain(RETIRED_OFF);
    expect(text).toContain(RETIRED_HIGH);
    expect(text.split(RETIRED_OFF).join("").split(RETIRED_HIGH).join("")).toContain(SUCCESSOR);

    const names = readdirSync(dirname(PROVIDER_CONFIG_PATH));
    expect(names.some((name) => name.startsWith("providers.json.phax-backup-"))).toBe(true);
  });

  it("ac-one-command: one --write drops modelEnvVar and leaves a loadable file", async () => {
    writeProviders(BEFORE_VIBE);
    const result = await call(["setup", "providers", "--write"]);
    expect(result.code).toBe(0);

    const vibe = readProviders().providers["mistral-vibe"] as {
      families: Record<string, { models: Array<{ id: string }> }>;
    };
    expect("modelEnvVar" in vibe).toBe(false);
    expect(vibe.families["mistral-medium"]?.models.map((m) => m.id)).toContain(SUCCESSOR);

    const text = `${result.out}\n${result.errLines.join("\n")}`;
    expect(text).toContain("providers.mistral-vibe.modelEnvVar");

    const loaded = await Effect.runPromise(
      loadProviderConfig().pipe(Effect.provide(NodeFileSystemLayer)),
    );
    const loadedVibe = loaded.providers["mistral-vibe"] as unknown as {
      families: Record<string, { models: Array<{ id: string }> }>;
    };
    expect(loadedVibe.families["mistral-medium"]?.models[0]?.id).toBe(SUCCESSOR);
  });
});

describe("pre-upgrade model-routing.json", () => {
  it("ac-routing-file: a key on a retired id is refused, naming its successor", async () => {
    const file = {
      ...DEFAULT_MODEL_ROUTING,
      equivalence: {
        ...DEFAULT_MODEL_ROUTING.equivalence,
        [RETIRED_HIGH]: {
          high: { claude: "claude-sonnet-4-6", effort: "high", relation: "equivalent" },
        },
      },
    };
    writeFileSync(MODEL_ROUTING_PATH, `${JSON.stringify(file, null, 2)}\n`);
    const error = await Effect.runPromise(
      Effect.flip(loadModelRouting().pipe(Effect.provide(NodeFileSystemLayer))),
    );
    expect(error.constructor.name).toBe("ConfigValidationError");
    expect(error.message).toContain(RETIRED_HIGH);
    expect(error.message.split(RETIRED_HIGH).join("")).toContain(SUCCESSOR);
  });
});
