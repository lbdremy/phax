import { Effect, Either } from "effect";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildVibeArgs, runVibeAgent } from "../../../src/infra/providers/mistralVibe.js";
import { AgentInvocationError, SecurityEnforcementError } from "../../../src/domain/errors.js";
import type { AgentRunOptions } from "../../../src/ports/backend.js";
import type { SecurityPolicy } from "../../../src/domain/security/types.js";
import {
  findVibeResultEvent,
  findVibeStreamHead,
  parseVibeVersion,
} from "../../../src/schemas/vibeOutput.js";
import { removeTempDir } from "../../helpers/tempGit.js";
import {
  VIBE3_EXPORT_LONG,
  VIBE3_EXPORT_SHORT,
  VIBE3_PONG_STREAM,
  VIBE3_RESUME_STREAM,
  VIBE3_SESSION_ID,
  vibe3Assistant,
  vibe3Callback,
  vibe3Effect,
  vibe3ExportText,
  vibe3StreamText,
  vibe3Text,
  vibe3User,
  writeFakeVibe,
} from "../../helpers/vibe3Fixtures.js";

const baseEntry = {
  executable: "vibe",
  modelEnvVar: "VIBE_ACTIVE_MODEL",
  defaultAgent: "auto-approve",
};

const unsafePolicy: SecurityPolicy = {
  mode: "unsafe",
  filesystem: { allowRead: [], allowWrite: [] },
  network: { profile: "open" },
  mcp: { mode: "provider-default", allow: [] },
  agentCommands: [],

  failClosed: false,
};

const securePolicy: SecurityPolicy = {
  mode: "secure",
  filesystem: {
    allowRead: ["/tmp/work", "/home/me/.phax"],
    allowWrite: ["/tmp/work", "/home/me/.phax"],
  },
  network: { profile: "provider-only" },
  mcp: { mode: "disabled", allow: [] },
  agentCommands: [],

  failClosed: true,
};

const baseOptions = (security: SecurityPolicy, cwd = "/tmp/work"): AgentRunOptions => ({
  provider: "mistral-vibe",
  model: "mistral-large",
  effort: "medium",
  cwd,
  security,
});

describe("buildVibeArgs — unsafe mode", () => {
  it("emits the host-trusted vector with --trust and unscoped workdir", () => {
    const args = buildVibeArgs(baseEntry, "print ok", baseOptions(unsafePolicy));
    expect(args).toEqual([
      "-p",
      "print ok",
      "--agent",
      "auto-approve",
      "--output",
      "streaming",
      "--trust",
      "--workdir",
      "/tmp/work",
    ]);
  });

  it("does not pass --target or the model alias (selection is env-only)", () => {
    const args = buildVibeArgs(baseEntry, "print ok", baseOptions(unsafePolicy));
    expect(args).not.toContain("--target");
    expect(args).not.toContain("mistral-large");
  });

  it("appends --resume when a session id is provided", () => {
    const args = buildVibeArgs(baseEntry, "do thing", baseOptions(unsafePolicy), "sess-abc-123");
    const resumeIdx = args.indexOf("--resume");
    expect(resumeIdx).toBeGreaterThan(0);
    expect(args[resumeIdx + 1]).toBe("sess-abc-123");
  });

  it("defaults --agent to auto-approve when entry has no defaultAgent", () => {
    const args = buildVibeArgs({ executable: "vibe" }, "p", baseOptions(unsafePolicy));
    const agentIdx = args.indexOf("--agent");
    expect(agentIdx).toBeGreaterThan(0);
    expect(args[agentIdx + 1]).toBe("auto-approve");
  });

  it.each([
    ["/runs/r1/phase-01/output.jsonl", "/runs/r1/phase-01/output.vibe-export"],
    ["/runs/r1/phase-01/fix-01.jsonl", "/runs/r1/phase-01/fix-01.vibe-export"],
  ])("sends --output-dir the export directory of the transcript %s", (transcript, exportDir) => {
    const args = buildVibeArgs(baseEntry, "p", {
      ...baseOptions(unsafePolicy),
      outputJsonlPath: transcript,
    });
    expect(args[args.indexOf("--output-dir") + 1]).toBe(exportDir);
  });
});

describe("buildVibeArgs — secure mode", () => {
  it("drops blanket --trust", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy));
    expect(args).not.toContain("--trust");
  });

  it("does not pass --target", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy));
    expect(args).not.toContain("--target");
  });

  it("scopes --workdir to the cwd (worktree)", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy));
    const idx = args.indexOf("--workdir");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(args[idx + 1]).toBe("/tmp/work");
  });

  it("emits --add-dir for writable paths outside cwd (e.g. ~/.phax)", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy));
    const addDirs: string[] = [];
    for (let i = 0; i < args.length - 1; i += 1) {
      if (args[i] === "--add-dir") {
        const v = args[i + 1];
        if (v !== undefined) addDirs.push(v);
      }
    }
    expect(addDirs).toEqual(["/home/me/.phax"]);
  });

  it("uses entry.defaultAgent as the (restricted) agent injection point", () => {
    const restrictedEntry = { ...baseEntry, defaultAgent: "phax-restricted" };
    const args = buildVibeArgs(restrictedEntry, "p", baseOptions(securePolicy));
    const idx = args.indexOf("--agent");
    expect(args[idx + 1]).toBe("phax-restricted");
  });

  it("appends --resume while keeping the secure vector", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions(securePolicy), "sess-xyz");
    expect(args).not.toContain("--trust");
    const resumeIdx = args.indexOf("--resume");
    expect(args[resumeIdx + 1]).toBe("sess-xyz");
  });

  it("isolated mode follows the secure branch for type totality (CLI gates it earlier)", () => {
    const args = buildVibeArgs(baseEntry, "p", baseOptions({ ...securePolicy, mode: "isolated" }));
    expect(args).not.toContain("--trust");
    expect(args).toContain("--workdir");
  });
});

describe("buildVibeArgs — secure mode fail-closed", () => {
  it("throws SecurityEnforcementError when secure policy has no writable paths", () => {
    const impossiblePolicy: SecurityPolicy = {
      ...securePolicy,
      filesystem: { allowRead: [], allowWrite: [] },
    };
    try {
      buildVibeArgs(baseEntry, "p", baseOptions(impossiblePolicy));
      throw new Error("expected buildVibeArgs to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SecurityEnforcementError);
      const e = err as SecurityEnforcementError;
      expect(e.provider).toBe("mistral-vibe");
      expect(e.mode).toBe("secure");
      expect(e.message).toMatch(/--trust/);
    }
  });
});

const entryOf = (executable: string) => ({ executable, modelEnvVar: "VIBE_ACTIVE_MODEL" });

const linesOf = (text: string): string[] => text.split("\n").filter((l) => l.trim().length > 0);

describe("findVibeResultEvent (Vibe 3 stream)", () => {
  it("is the assistant's text past the effect and callback entries around it", () => {
    expect(findVibeResultEvent(linesOf(vibe3StreamText(VIBE3_PONG_STREAM)))).toEqual({
      finalText: "PONG",
    });
  });

  it("joins the text blocks of the last assistant message in order with no separator", () => {
    const lines = linesOf(vibe3StreamText(VIBE3_RESUME_STREAM));
    expect(findVibeResultEvent(lines)).toEqual({ finalText: "DONE" });
  });

  it("skips blocks that are not text", () => {
    const entry = vibe3Assistant([
      { type: "thinking", text: "hmm" },
      vibe3Text("A"),
      { type: "tool_use", name: "bash" },
      { type: "text", text: 5 },
      vibe3Text("B"),
    ]);
    expect(findVibeResultEvent(linesOf(vibe3StreamText([entry])))).toEqual({ finalText: "AB" });
  });

  it("takes the last assistant message holding a text block, not a later one without", () => {
    const lines = linesOf(
      vibe3StreamText([
        vibe3Assistant([vibe3Text("the answer")], 10),
        vibe3Assistant([{ type: "tool_use", name: "bash" }], 20),
        vibe3Callback(30),
      ]),
    );
    expect(findVibeResultEvent(lines)).toEqual({ finalText: "the answer" });
  });

  it("ignores user messages and non-message entries", () => {
    const lines = linesOf(vibe3StreamText([vibe3User("hi", 1), vibe3Effect(2), vibe3Callback(3)]));
    expect(findVibeResultEvent(lines)).toBeUndefined();
  });

  it("skips lines that are blank or not JSON, and entries of an unknown shape", () => {
    const answer = linesOf(vibe3StreamText([vibe3Assistant([vibe3Text("ok")], 5)]));
    const lines = ["", "not json", '{"type":"message"}', '["x"]', ...answer, "  "];
    expect(findVibeResultEvent(lines)).toEqual({ finalText: "ok" });
  });

  it("is undefined for an empty stream", () => {
    expect(findVibeResultEvent([])).toBeUndefined();
  });

  it("returns an answer or none for arbitrary mutations of a stream, never a crash", () => {
    const valid = linesOf(vibe3StreamText(VIBE3_PONG_STREAM));
    let seed = 0x2f6e2b1;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed;
    };
    const junk = ["null", "1", '"x"', "[]", "{}", '{"type":"message","content":3}', "\u0000", "{"];
    for (let round = 0; round < 300; round += 1) {
      const lines = valid.map((line) => {
        const cut = next() % (line.length + 1);
        switch (next() % 4) {
          case 0:
            return line.slice(0, cut);
          case 1:
            return line.slice(0, cut) + junk[next() % junk.length]! + line.slice(cut);
          case 2:
            return junk[next() % junk.length]!;
          default:
            return line;
        }
      });
      const found = findVibeResultEvent(lines);
      expect(found === undefined || typeof found.finalText === "string").toBe(true);
      const head = findVibeStreamHead(lines);
      expect(head === undefined || typeof head.sessionId === "string").toBe(true);
    }
  });
});

describe("findVibeStreamHead", () => {
  it("is the session id and creation time of the first entry that decodes", () => {
    const lines = ["garbage", ...linesOf(vibe3StreamText(VIBE3_PONG_STREAM))];
    expect(findVibeStreamHead(lines)).toEqual({
      sessionId: VIBE3_SESSION_ID,
      createdAt: 1793116135001,
    });
  });

  it("is undefined when no entry carries a session id and a creation time", () => {
    expect(findVibeStreamHead(['{"type":"message","role":"assistant"}', "x"])).toBeUndefined();
    expect(findVibeStreamHead([])).toBeUndefined();
  });
});

describe("parseVibeVersion", () => {
  it.each([
    ["vibe 3.0.3", { major: 3, minor: 0, patch: 3 }],
    ["vibe 3.0.3\n", { major: 3, minor: 0, patch: 3 }],
    ["mistral-vibe 2.13.0", { major: 2, minor: 13, patch: 0 }],
    ["3.10.12", { major: 3, minor: 10, patch: 12 }],
    ["vibe 3.1.0-rc.1", { major: 3, minor: 1, patch: 0 }],
  ])("reads %j", (text, expected) => {
    expect(parseVibeVersion(text)).toEqual(expected);
  });

  it.each(["", "vibe", "vibe 3.0", "command not found"])("reports %j as unparseable", (text) => {
    expect(parseVibeVersion(text)).toBeUndefined();
  });
});

describe("runVibeAgent against a fake vibe", () => {
  let root: string;
  let phaseFolder: string;
  let transcript: string;
  let n = 0;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "phax-vibe-adapter-"));
    phaseFolder = join(root, "phase-01");
    mkdirSync(phaseFolder, { recursive: true });
    transcript = join(phaseFolder, "output.jsonl");
  });

  afterEach(() => removeTempDir(root));

  const fakeIn = (options: Parameters<typeof writeFakeVibe>[1]) => {
    n += 1;
    return writeFakeVibe(join(root, `bin-${n}`), options);
  };
  const optionsFor = (outputJsonlPath: string = transcript): AgentRunOptions => ({
    ...baseOptions(unsafePolicy, root),
    outputJsonlPath,
    phaseFolderPath: phaseFolder,
  });
  const run = (
    executable: string,
    options: AgentRunOptions = optionsFor(),
    resumeSessionId?: string,
  ) =>
    Effect.runPromise(
      Effect.either(runVibeAgent("print ok", options, entryOf(executable), resumeSessionId)),
    );
  const failureOf = async (
    executable: string,
    options: AgentRunOptions = optionsFor(),
  ): Promise<AgentInvocationError> => {
    const result = await run(executable, options);
    if (Either.isRight(result)) throw new Error("expected the turn to fail");
    expect(result.left).toBeInstanceOf(AgentInvocationError);
    return result.left as AgentInvocationError;
  };

  it("answers with the stream's PONG and the export's session id, and keeps both beside each other", async () => {
    const fake = fakeIn({ exportText: vibe3ExportText(VIBE3_EXPORT_SHORT) });

    const result = await run(fake.executable);

    expect(Either.isRight(result)).toBe(true);
    if (Either.isLeft(result)) return;
    expect(result.right).toMatchObject({
      finalText: "PONG",
      sessionId: VIBE3_SESSION_ID,
      outputPath: transcript,
    });
    expect(readFileSync(transcript, "utf8")).toBe(vibe3StreamText(VIBE3_PONG_STREAM));
    expect(readFileSync(join(phaseFolder, "output.vibe-export", "export.json"), "utf8")).toBe(
      vibe3ExportText(VIBE3_EXPORT_SHORT),
    );
    expect(readFileSync(join(phaseFolder, "claude-session-id.txt"), "utf8")).toBe(VIBE3_SESSION_ID);
  });

  it("passes --output-dir the turn's export directory, and --resume on a resume", async () => {
    const fake = fakeIn({ exportText: vibe3ExportText(VIBE3_EXPORT_SHORT) });

    await run(fake.executable, optionsFor(), VIBE3_SESSION_ID);

    const turn = fake.invocations().find((line) => line.startsWith("-p "));
    expect(turn).toContain(`--output-dir ${join(phaseFolder, "output.vibe-export")}`);
    expect(turn).toContain(`--resume ${VIBE3_SESSION_ID}`);
  });

  it("gives two turns of one session each their own export, neither overwriting the other", async () => {
    const first = fakeIn({ exportText: vibe3ExportText(VIBE3_EXPORT_SHORT) });
    const second = fakeIn({
      stream: vibe3StreamText(VIBE3_RESUME_STREAM),
      exportText: vibe3ExportText(VIBE3_EXPORT_LONG),
    });

    await run(first.executable, optionsFor(join(phaseFolder, "output.jsonl")));
    const resumed = await run(
      second.executable,
      optionsFor(join(phaseFolder, "fix-01.jsonl")),
      VIBE3_SESSION_ID,
    );

    expect(Either.isRight(resumed) && resumed.right.finalText).toBe("DONE");
    expect(readFileSync(join(phaseFolder, "output.vibe-export", "export.json"), "utf8")).toBe(
      vibe3ExportText(VIBE3_EXPORT_SHORT),
    );
    expect(readFileSync(join(phaseFolder, "fix-01.vibe-export", "export.json"), "utf8")).toBe(
      vibe3ExportText(VIBE3_EXPORT_LONG),
    );
  });

  it("fails naming the missing export and the exact path read when the turn wrote none", async () => {
    const fake = fakeIn({});

    const error = await failureOf(fake.executable);

    expect(error.message).toContain("missing Vibe export");
    expect(error.message).toContain(join(phaseFolder, "output.vibe-export", "export.json"));
  });

  it("fails naming the invalid export and its path when export.json does not decode", async () => {
    const fake = fakeIn({ exportText: '{"schema_version":2}' });

    const error = await failureOf(fake.executable);

    expect(error.message).toContain("invalid Vibe export");
    expect(error.message).toContain(join(phaseFolder, "output.vibe-export", "export.json"));
  });

  it("fails naming the missing assistant text and the stream when no assistant message has a text block", async () => {
    const fake = fakeIn({
      stream: vibe3StreamText([vibe3Effect(1), vibe3Assistant([{ type: "tool_use" }], 2)]),
      exportText: vibe3ExportText(VIBE3_EXPORT_SHORT),
    });

    const error = await failureOf(fake.executable);

    expect(error.message).toContain("no assistant message with a text block");
    expect(error.message).toContain(transcript);
  });

  it("fails on a non-zero exit without reading an export", async () => {
    const fake = fakeIn({ exitCode: 2, exportText: vibe3ExportText(VIBE3_EXPORT_SHORT) });

    const error = await failureOf(fake.executable);

    expect(error.message).toBe("vibe exited with code 2");
    expect(error.exitCode).toBe(2);
  });

  it("refuses a turn without a transcript path before spawning anything", async () => {
    const fake = fakeIn({ exportText: vibe3ExportText(VIBE3_EXPORT_SHORT) });

    const withoutTranscript: AgentRunOptions = {
      ...baseOptions(unsafePolicy, root),
      phaseFolderPath: phaseFolder,
    };

    const error = await failureOf(fake.executable, withoutTranscript);

    expect(error.message).toContain("transcript path");
    expect(fake.invocations()).toEqual([]);
    expect(existsSync(join(phaseFolder, "output.vibe-export"))).toBe(false);
  });

  describe("the version floor", () => {
    const exportText = vibe3ExportText(VIBE3_EXPORT_SHORT);

    it.each(["vibe 2.13.0", "vibe 3.0.2", "mistral-vibe 2.99.99"])(
      "refuses %s before any session spawns",
      async (version) => {
        const fake = fakeIn({ version, exportText });

        const error = await failureOf(fake.executable);

        const installed = /\d+\.\d+\.\d+/.exec(version)![0];
        expect(error.message).toBe(
          `mistral-vibe ${installed} is installed; phax needs 3.0.3 or later.\nUpgrade it: uv tool upgrade mistral-vibe`,
        );
        expect(fake.invocations()).toEqual(["--version"]);
        expect(existsSync(join(phaseFolder, "output.vibe-export"))).toBe(false);
      },
    );

    it.each(["not a version", "", "vibe 3.0"])(
      "refuses unparseable --version output %j, naming what was printed",
      async (version) => {
        const fake = fakeIn({ version, exportText });

        const error = await failureOf(fake.executable);

        expect(error.message).toContain(JSON.stringify(version));
        expect(error.message).toContain("3.0.3");
        expect(error.message).toContain("uv tool upgrade mistral-vibe");
        expect(fake.turns()).toBe(0);
      },
    );

    it.each(["vibe 3.0.3", "vibe 3.0.4", "vibe 3.1.0", "vibe 4.0.0"])(
      "runs %s",
      async (version) => {
        const fake = fakeIn({ version, exportText });

        const result = await run(fake.executable);

        expect(Either.isRight(result)).toBe(true);
        expect(fake.turns()).toBe(1);
      },
    );

    it("reads the version once per executable, however many sessions it runs", async () => {
      const fake = fakeIn({ exportText });

      await run(fake.executable);
      await run(fake.executable, optionsFor(join(phaseFolder, "fix-01.jsonl")), VIBE3_SESSION_ID);

      expect(fake.versionReads()).toBe(1);
      expect(fake.turns()).toBe(2);
    });

    it("refuses an executable that cannot run, and asks again the next time", async () => {
      const missing = join(root, "no-such-dir", "vibe");

      const error = await failureOf(missing);

      expect(error.message).toContain("Could not run");
      expect(error.message).toContain("uv tool upgrade mistral-vibe");
      // The failed read is not remembered: once the binary exists the session runs.
      const fake = writeFakeVibe(join(root, "no-such-dir"), { exportText });
      expect(fake.executable).toBe(missing);
      expect(Either.isRight(await run(missing))).toBe(true);
    });
  });
});
