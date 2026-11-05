import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Effect, Either } from "effect";
import { describe, expect, it, vi } from "vitest";
import { buildDecideInvocation, claudeSessionAdapter } from "../../src/domain/session/claude.js";
import { makeFakeSession } from "../../src/infra/fakes/session.js";
import { runClaudeProbe } from "../../src/infra/providers/claudeCode.js";
import { Session } from "../../src/ports/session.js";
import { PROBE_EFFORT, PROBE_MODEL } from "../../src/domain/cost/probe.js";
import type { SecurityPolicy } from "../../src/domain/security/types.js";
import {
  phaseScripts,
  runHeadlessPlan,
  SESSION,
  useFakeClaude,
} from "../helpers/projectOnlyHarness.js";
import { removeTempDir } from "../helpers/tempGit.js";

// The boundaries of project-only launches that already held before the
// switches went in, and must keep holding: the operator's environment reaches
// a session unchanged, interactive launches and the usage probe stay as they
// were, and a run never touches the operator's configuration root.

const fake = useFakeClaude();

const SWITCH = "CLAUDE_CODE_DISABLE_AUTO_MEMORY";
const OPUS = "claude-opus-5-5";

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: { allowRead: ["/work"], allowWrite: ["/work"] },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],
  failClosed: true,
};

async function runOnePhase(): Promise<Awaited<ReturnType<typeof runHeadlessPlan>>> {
  fake.cli.setScripts([...phaseScripts("phase-01", SESSION, { fix: false })]);
  const run = await runHeadlessPlan(fake, {
    phases: [{ id: "phase-01", model: OPUS }],
    gate: "pass",
    records: false,
  });
  expect(Either.isRight(run.result)).toBe(true);
  return run;
}

describe("ac-env-kept", () => {
  it("hands ANTHROPIC_API_KEY, CLAUDE_CONFIG_DIR and an unrelated variable to a headless session unchanged", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "phax-config-root-"));
    try {
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-made-up-key");
      vi.stubEnv("CLAUDE_CONFIG_DIR", configDir);
      vi.stubEnv("PHAX_TEST_UNRELATED", "kept as it is");

      await runOnePhase();

      const [work] = fake.claudeLaunches();
      expect(work?.env["ANTHROPIC_API_KEY"]).toBe("sk-made-up-key");
      expect(work?.env["CLAUDE_CONFIG_DIR"]).toBe(configDir);
      expect(work?.env["PHAX_TEST_UNRELATED"]).toBe("kept as it is");
    } finally {
      removeTempDir(configDir);
    }
  });
});

// Each launch is handed to the Session port the way the commands hand it,
// and the fake records what would be spawned.
async function launched(invocation: {
  executable: string;
  args: readonly string[];
  cwd: string;
  env?: Record<string, string>;
}) {
  const session = makeFakeSession();
  await Effect.runPromise(
    Effect.gen(function* () {
      const port = yield* Session;
      yield* port.resume({ ...invocation, env: invocation.env ?? {} });
    }).pipe(Effect.provide(session.layer)),
  );
  return session.impl.invocations[0]!;
}

describe("ac-interactive", () => {
  const sessionId = "3f2b9c1e-6a4d-4e8f-9b21-7c5d0e8a1f42";
  const posture = {
    policy: securePolicy,
    agentCommands: [],
  } as const;

  const launches = [
    {
      name: "phax enter's resume",
      build: () =>
        claudeSessionAdapter.buildResumeInvocation({
          phaseId: "phase-01",
          sessionId,
          worktreePath: "/work",
        } as Parameters<typeof claudeSessionAdapter.buildResumeInvocation>[0]),
    },
    {
      name: "phax enter's pre-prompted first turn",
      build: () =>
        claudeSessionAdapter.buildPrePromptedInvocation({
          cwd: "/work",
          sessionId,
          initialPrompt: "Read the seed.",
          model: OPUS,
          effort: "medium",
        }),
    },
    {
      name: "a stop's continue command",
      build: () =>
        claudeSessionAdapter.buildContinueCommand({
          sessionId,
          model: OPUS,
          effort: "medium",
          cwd: "/work",
          posture,
        }),
    },
    {
      name: "a stop's fresh-start command",
      build: () =>
        claudeSessionAdapter.buildFreshStartCommand({
          model: OPUS,
          effort: "medium",
          cwd: "/work",
          prompt: "Review the phase.",
          posture,
        }),
    },
    {
      name: "decide's interactive session",
      build: () =>
        buildDecideInvocation({
          cwd: "/work",
          session: { kind: "new", id: sessionId },
          model: OPUS,
          effort: "medium",
          permissionFlags: ["--permission-mode", "acceptEdits"],
          prompt: "Open the prompt file.",
        }),
    },
  ] as const;

  it.each(launches)(
    "$name carries no --setting-sources and no phax-set memory switch",
    async ({ build }) => {
      vi.stubEnv(SWITCH, undefined);
      const built = build();
      if ("unsupported" in built) throw new Error(built.unsupported);
      const spawned = await launched(built);
      expect(spawned.executable).toBe("claude");
      expect(spawned.args).not.toContain("--setting-sources");
      expect(spawned.env).not.toHaveProperty(SWITCH);
    },
  );
});

describe("ac-probe", () => {
  it("launches the usage probe without --setting-sources and without a phax-set memory switch", async () => {
    vi.stubEnv(SWITCH, undefined);
    fake.cli.setScript({ sessionId: SESSION, finalText: "ok" });

    const result = await Effect.runPromise(
      runClaudeProbe("ping", { model: PROBE_MODEL, effort: PROBE_EFFORT, timeoutMs: 30_000 }),
    );

    expect(result.kind).toBe("ended");
    const [probe] = fake.claudeLaunches();
    expect(probe).toBeDefined();
    expect(probe?.argv).not.toContain("--setting-sources");
    expect(probe?.env).not.toHaveProperty(SWITCH);
  });
});

interface FileState {
  readonly bytes: string;
  readonly mtimeMs: number;
}

function snapshotOf(root: string): Map<string, FileState> {
  const files = new Map<string, FileState>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        files.set(relative(root, path), {
          bytes: readFileSync(path).toString("base64"),
          mtimeMs: statSync(path).mtimeMs,
        });
      }
    }
  };
  walk(root);
  return files;
}

function filesUnder(root: string): string[] {
  return [...snapshotOf(root).keys()];
}

describe("ac-no-touch", () => {
  it("leaves the configuration root's files, bytes and mtimes identical and copies none of them into the run", async () => {
    const root = mkdtempSync(join(tmpdir(), "phax-config-root-"));
    try {
      const planted: Record<string, string> = {
        "settings.json": '{"model":"planted-model-marker"}\n',
        "CLAUDE.md": "planted user instructions marker\n",
        "rules/style.md": "planted rule marker\n",
        "skills/planted/SKILL.md": "planted skill marker\n",
        "projects/-planted/memory/MEMORY.md": "planted memory index marker\n",
      };
      for (const [path, content] of Object.entries(planted)) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      vi.stubEnv("CLAUDE_CONFIG_DIR", root);
      const before = snapshotOf(root);

      const run = await runOnePhase();

      // The stub files its own transcripts under HOME, not under the root, so
      // nothing is excluded: the root is byte-for-byte what it was.
      expect(snapshotOf(root)).toEqual(before);
      expect(filesUnder(root).toSorted()).toEqual(Object.keys(planted).toSorted());

      // With transcripts off phax reads nothing under the root: no planted
      // content reaches the run's state folder or the repository.
      for (const dir of [join(fake.root, "state"), run.repoRoot]) {
        for (const file of filesUnder(dir)) {
          if (file.startsWith(".git/") || file.includes("/.git/")) continue;
          expect(readFileSync(join(dir, file), "utf8")).not.toContain("planted");
        }
      }
    } finally {
      removeTempDir(root);
    }
  });
});
