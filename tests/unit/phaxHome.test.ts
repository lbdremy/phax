// The phax home's resolution: the PHAX_HOME decoder, the pure rules and the one resolution point,
// then what follows the home (the journal, the default home's providers.json) and what never
// moves with it (the provider store roots, under the user's home).
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Result } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadProviderConfig } from "../../src/app/loadRouting.js";
import { resolvePhaxHome } from "../../src/app/phaxHome.js";
import { makeGlobalTelemetryJournalLayerOrNoop } from "../../src/cli/commands/runLayers.js";
import { ConfigValidationError } from "../../src/domain/errors.js";
import { invalidPhaxHomeMessage, phaxHomeFile } from "../../src/domain/phaxHome.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { ProviderStoreRootsLive } from "../../src/infra/providerStoreRoots.js";
import { ProviderStoreRoots } from "../../src/ports/providerStores.js";
import { SystemTelemetry } from "../../src/ports/systemTelemetry.js";
import { decodePhaxHomeVariable } from "../../src/schemas/phaxHome.js";
import { isolatePhaxHome } from "../helpers/isolatePhaxHome.js";
import { removeTempDir } from "../helpers/tempGit.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

let isolation: ReturnType<typeof isolatePhaxHome>;
let scratch: string;

beforeEach(() => {
  isolation = isolatePhaxHome();
  scratch = mkdtempSync(join(tmpdir(), "phax-home-test-"));
});

afterEach(() => {
  delete process.env["PHAX_HOME"];
  removeTempDir(scratch);
  isolation.restore();
});

describe("decodePhaxHomeVariable", () => {
  it("answers unset for undefined and set for an absolute path", () => {
    expect(decodePhaxHomeVariable(undefined)).toEqual(Result.succeed({ kind: "unset" }));
    expect(decodePhaxHomeVariable("/srv/phax")).toEqual(
      Result.succeed({ kind: "set", path: "/srv/phax" }),
    );
  });

  it.each(["", "~/phax-ci", "relative/dir", "./here"])("refuses %j", (raw) => {
    expect(Result.isFailure(decodePhaxHomeVariable(raw))).toBe(true);
  });
});

describe("phax-home rules", () => {
  it("names a file inside the home", () => {
    expect(phaxHomeFile({ path: "/srv/phax", from: "PHAX_HOME" }, "providers.json")).toBe(
      "/srv/phax/providers.json",
    );
  });

  it("words the refusal exactly", () => {
    expect(invalidPhaxHomeMessage("x")).toBe(
      'PHAX_HOME must be an absolute path to a directory, got "x"',
    );
  });
});

describe("resolvePhaxHome", () => {
  it("unset gives <user home>/.phax from default", () => {
    expect(resolvePhaxHome({}, "/home/dev")).toEqual(
      Result.succeed({ path: "/home/dev/.phax", from: "default" }),
    );
  });

  it("an absolute existing directory gives that path from PHAX_HOME", () => {
    expect(resolvePhaxHome({ PHAX_HOME: scratch }, "/home/dev")).toEqual(
      Result.succeed({ path: scratch, from: "PHAX_HOME" }),
    );
  });

  it("an absolute path that does not exist yet gives that path from PHAX_HOME", () => {
    const later = join(scratch, "not", "yet");
    expect(resolvePhaxHome({ PHAX_HOME: later }, "/home/dev")).toEqual(
      Result.succeed({ path: later, from: "PHAX_HOME" }),
    );
  });

  const refusals: ReadonlyArray<readonly [string, () => string]> = [
    ["an empty value", () => ""],
    ["an unexpanded ~/phax-ci", () => "~/phax-ci"],
    ["relative/dir", () => "relative/dir"],
    [
      "an existing regular file",
      () => {
        const file = join(scratch, "a-file");
        writeFileSync(file, "");
        return file;
      },
    ],
  ];

  it.each(refusals)("refuses %s, naming PHAX_HOME and the value", (_label, value) => {
    const raw = value();
    const result = resolvePhaxHome({ PHAX_HOME: raw }, "/home/dev");
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toBeInstanceOf(ConfigValidationError);
      expect(result.failure.path).toBe("PHAX_HOME");
      expect(result.failure.message).toBe(
        `PHAX_HOME must be an absolute path to a directory, got "${raw}"`,
      );
    }
  });

  it("is resolved per call: a changed PHAX_HOME or HOME changes the next answer", () => {
    const first = Result.getOrThrow(resolvePhaxHome());
    expect(first).toEqual({ path: join(isolation.home, ".phax"), from: "default" });

    process.env["PHAX_HOME"] = scratch;
    expect(Result.getOrThrow(resolvePhaxHome())).toEqual({ path: scratch, from: "PHAX_HOME" });
    delete process.env["PHAX_HOME"];

    const second = isolatePhaxHome();
    try {
      expect(Result.getOrThrow(resolvePhaxHome()).path).toBe(join(second.home, ".phax"));
    } finally {
      second.restore();
    }
  });
});

/** Each regular file under `dir`, relative path → sha256, recursively. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir, { recursive: true, encoding: "utf8" })) {
    const path = join(dir, name);
    if (!statSync(path).isFile()) continue;
    out[name] = createHash("sha256").update(readFileSync(path)).digest("hex");
  }
  return out;
}

describe("what follows the phax home", () => {
  it("ac-moves: with telemetry on and PHAX_HOME set, the journal lands under PHAX_HOME and ~/.phax is unchanged", async () => {
    const userPhax = join(homedir(), ".phax");
    writeFileSync(join(userPhax, "telemetry.json"), JSON.stringify({ enabled: true }));
    const before = snapshot(userPhax);
    const moved = join(scratch, "moved-home");
    process.env["PHAX_HOME"] = moved;

    await Effect.runPromise(
      Effect.gen(function* () {
        const telemetry = yield* SystemTelemetry;
        yield* telemetry.incrementCounter("phax.home.test");
      }).pipe(Effect.provide(makeGlobalTelemetryJournalLayerOrNoop())),
    );

    expect(snapshot(userPhax)).toEqual(before);
    const names = readdirSync(moved);
    expect(names).toContain("telemetry.json");
    const journals = names.filter((name) => name.endsWith(".jsonl"));
    expect(journals).toHaveLength(1);
    const journal = journals.map((name) => readFileSync(join(moved, name), "utf8")).join("");
    expect(journal).toContain("phax.home.test");
  });

  it("ac-default-unchanged: with PHAX_HOME unset, the user's ~/.phax/providers.json is read", async () => {
    const codexOn = {
      providers: {
        ...DEFAULT_PROVIDER_CONFIG.providers,
        "codex-cli": { ...DEFAULT_PROVIDER_CONFIG.providers["codex-cli"], enabled: true },
      },
    };
    writeFileSync(join(isolation.home, ".phax", "providers.json"), JSON.stringify(codexOn));

    const config = await Effect.runPromise(
      loadProviderConfig().pipe(Effect.provide(NodeFileSystemLayer)),
    );
    expect(config.providers["codex-cli"]?.enabled).toBe(true);
  });

  it("ac-never-moves: with PHAX_HOME set, the provider store roots stay under the user's home", async () => {
    process.env["PHAX_HOME"] = scratch;
    vi.stubEnv("CLAUDE_CONFIG_DIR", undefined);
    vi.stubEnv("CODEX_HOME", undefined);
    try {
      const roots = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* ProviderStoreRoots;
        }).pipe(Effect.provide(ProviderStoreRootsLive)),
      );
      expect(roots).toEqual({
        claude: join(isolation.home, ".claude"),
        codex: join(isolation.home, ".codex"),
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
