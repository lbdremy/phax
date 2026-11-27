import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Result } from "effect";
import * as Schema from "effect/Schema";
import { resolvePhaxHome } from "../../src/app/phaxHome.js";
import { phaxHomeFile } from "../../src/domain/phaxHome.js";
import {
  makeAgentGroup,
  makeAgentResolveCommand,
  REAL_AGENT_LAYERS,
} from "../../src/cli/definitions/agent.js";
import {
  DEFAULT_MODEL_ROUTING,
  DEFAULT_PROVIDER_CONFIG,
} from "../../src/domain/routing/defaults.js";
import { resolveModel } from "../../src/domain/routing/resolve.js";
import type { ThinkingLevel } from "../../src/domain/routing/types.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeFakeShell } from "../../src/infra/fakes/shell.js";
import { runnerCall } from "../helpers/runnerCall.js";

vi.mock("node:os", async (importOriginal) =>
  (await import("../helpers/isolatePhaxHome.js")).isolatedOs(await importOriginal()),
);

// The `agent` group through the command runner, over a real file system rooted in the temporary
// PHAX home (the module-level paths of ~/.phax and ~/.vibe point there) and a fake Shell: no probe
// runs a real executable and no real ~/.phax, ~/.claude, ~/.codex or ~/.vibe is read.
//   ac-json-every-command, ac-versioned-stable, ac-text-unchanged, ac-error-sentence, ac-written
//   and ac-groups.

const MESSAGE_KINDS = ["note", "written", "error", "refused", "defect"];
const DIGEST = /^sha256:[0-9a-f]{64}$/;

interface WrittenFile {
  readonly path: string;
  readonly format: string | null;
  readonly digest: string;
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

function sha256(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function messageKinds(errLines: ReadonlyArray<string>): ReadonlyArray<string> {
  return errLines.map((line) => (JSON.parse(line) as { kind: string }).kind);
}

function removeBackups(path: string): void {
  const dir = dirname(path);
  for (const name of readdirSync(dir)) {
    if (name.includes(".phax-backup-")) rmSync(`${dir}/${name}`);
  }
}

// The phax home's files, resolved at call time like phax resolves them.
const homeFile = (name: "providers.json" | "model-routing.json"): string =>
  phaxHomeFile(Result.getOrThrow(resolvePhaxHome()), name);

beforeEach(() => {
  for (const path of [homeFile("providers.json"), homeFile("model-routing.json")]) {
    rmSync(path, { force: true });
    mkdirSync(dirname(path), { recursive: true });
    removeBackups(path);
  }
});

describe("agent --json", () => {
  it.each([
    ["models", ["models"]],
    ["resolve", ["resolve", "--model", "claude-sonnet-4-6", "--effort", "medium"]],
    ["probe", ["probe"]],
    ["setup providers", ["setup", "providers"]],
  ])("%s answers one indented JSON value and only message lines on stderr", async (_, argv) => {
    const result = await call([...argv, "--json"]);
    expect(result.code).toBe(0);
    expect(result.out.endsWith("}\n")).toBe(true);
    const value: unknown = JSON.parse(result.out);
    expect(result.out).toBe(`${JSON.stringify(value, null, 2)}\n`);
    for (const kind of messageKinds(result.errLines)) expect(MESSAGE_KINDS).toContain(kind);
  });

  it("probe answers each provider's availability and whether config enables it", async () => {
    const result = await call(["probe", "--json"]);
    expect(JSON.parse(result.out)).toEqual({
      providers: [
        { provider: "claude-code", available: true, enabled: true },
        { provider: "mistral-vibe", available: true, enabled: false },
        { provider: "codex-cli", available: false, enabled: false },
      ],
    });
  });

  it("probe prints today's text without --json", async () => {
    const result = await call(["probe"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("  claude-code: available\n");
    expect(result.out).toContain("  codex-cli: unavailable (disabled in config)\n");
  });
});

describe("agent resolve --json", () => {
  // A request whose selection carries a thinking level, and one whose selection carries none.
  const REQUESTS: ReadonlyArray<readonly [string, ThinkingLevel]> = [
    ["claude-sonnet-4-6", "medium"],
    ["claude-sonnet-4-6", "none"],
    ["claude-haiku-4-5", "off"],
    ["claude-opus-4-6", "max"],
  ];

  it.each(REQUESTS)(
    "writes JSON.stringify of the resolution for %s @ %s",
    async (model, effort) => {
      const expected = resolveModel(
        { model, effort },
        DEFAULT_MODEL_ROUTING,
        DEFAULT_PROVIDER_CONFIG,
      );
      const result = await call(["resolve", "--model", model, "--effort", effort, "--json"]);
      expect(result.code).toBe(0);
      expect(result.out).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    },
  );

  it("encodes a resolution with no thinking level, or with skipped providers, as stringify does", () => {
    // The default catalog always selects a thinking level, so the absent key is checked on the
    // contract itself, with the key order of the resolver's objects.
    const contract = makeAgentResolveCommand(REAL_AGENT_LAYERS).output.contract as Schema.Codec<
      unknown,
      unknown
    >;
    const base = resolveModel(
      { model: "claude-sonnet-4-6", effort: "medium" },
      DEFAULT_MODEL_ROUTING,
      DEFAULT_PROVIDER_CONFIG,
    );
    const { thinking: _thinking, ...selected } = base.selected;
    const resolutions = [
      { ...base, selected },
      {
        ...base,
        reason: `${base.reason} Skipped for security.`,
        skippedForSecurity: [{ provider: "codex-cli", reason: "network" }],
      },
    ];
    for (const resolution of resolutions) {
      expect(JSON.stringify(Schema.encodeUnknownSync(contract)(resolution), null, 2)).toBe(
        JSON.stringify(resolution, null, 2),
      );
    }
    expect("thinking" in selected).toBe(false);
  });

  it("keeps today's sentence and exit 2 for an effort just outside the levels", async () => {
    const sentence =
      'Invalid effort level "ultrax". Must be one of: none, off, low, medium, high, xhigh, max, ultracode, ultra';
    const text = await call(["resolve", "--model", "claude-sonnet-4-6", "--effort", "ultrax"]);
    expect(text.code).toBe(2);
    expect(text.out).toBe("");
    expect(text.err).toBe(`${sentence}\n`);

    const json = await call([
      "resolve",
      "--model",
      "claude-sonnet-4-6",
      "--effort",
      "ultrax",
      "--json",
    ]);
    expect(json.code).toBe(2);
    expect(json.out).toBe("");
    expect(json.errLines).toHaveLength(1);
    expect(JSON.parse(json.errLines[0]!)).toMatchObject({ kind: "error", exit: 2 });
    expect(json.errLines[0]).toContain(JSON.stringify(sentence).slice(1, -1));
  });
});

describe("agent setup written files", () => {
  it("setup providers --write --json lists providers.json, then its backup, as absolute records", async () => {
    const first = await call(["setup", "providers", "--write", "--json"]);
    expect(first.code).toBe(0);
    const firstValue = JSON.parse(first.out) as {
      written: WrittenFile[];
      backupPath: string | null;
    };
    expect(firstValue.backupPath).toBeNull();
    expect(firstValue.written.map((file) => file.path)).toEqual([homeFile("providers.json")]);

    const second = await call(["setup", "providers", "--write", "--with-routing", "--json"]);
    const value = JSON.parse(second.out) as { written: WrittenFile[]; backupPath: string };
    expect(value.written.map((file) => file.path)).toEqual([
      homeFile("providers.json"),
      value.backupPath,
      homeFile("model-routing.json"),
    ]);
    for (const file of value.written) {
      expect(isAbsolute(file.path)).toBe(true);
      expect(file.digest).toMatch(DIGEST);
      expect(file.digest).toBe(sha256(file.path));
    }
  });

  it("setup providers without --write writes nothing and says so", async () => {
    const result = await call(["setup", "providers"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Dry run — no changes written.\n");
    const json = JSON.parse((await call(["setup", "providers", "--json"])).out) as {
      written: unknown[];
      retiredRemoved: unknown[];
      retiredReplaced: unknown[];
      fieldsDropped: unknown[];
    };
    expect(json.written).toEqual([]);
    expect(json.retiredRemoved).toEqual([]);
    expect(json.retiredReplaced).toEqual([]);
    expect(json.fieldsDropped).toEqual([]);
  });
});

describe("agent groups", () => {
  it.each([[["agent"]], [["agent", "setup"]]])(
    "%j alone writes its help on stderr and exits 64",
    async (argv) => {
      const result = await runnerCall([group()], argv);
      expect(result.code).toBe(64);
      expect(result.out).toBe("");
      expect(result.err).toContain("Usage:");
    },
  );

  it("agent setup providers runs", async () => {
    const result = await call(["setup", "providers"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("Dry run — no changes written.");
  });
});
