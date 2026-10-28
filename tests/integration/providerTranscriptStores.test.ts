import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeRecordUsage } from "../../src/app/recordPlumbing.js";
import { makeProviderBackendLayer, provideRunLayers } from "../../src/cli/commands/runLayers.js";
import { DEFAULT_PROVIDER_CONFIG } from "../../src/domain/routing/defaults.js";
import type { ProviderId } from "../../src/domain/routing/types.js";
import { makeFakeFileSystem } from "../../src/infra/fakes/fs.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { makeNodeBackendLayer } from "../../src/infra/providers/dispatcher.js";
import { claudeProjectSlug } from "../../src/infra/providers/transcriptStore.js";
import { Backend, type TranscriptRead } from "../../src/ports/backend.js";
import { FileSystem, type FileSystemOps } from "../../src/ports/fs.js";
import { ProviderStoreRoots } from "../../src/ports/providerStores.js";
import { NoopSystemTelemetryLayer } from "../../src/ports/systemTelemetry.js";
import type { ResolvedConfig } from "../../src/schemas/phaxConfig.js";
import { providerStoreRootsUnder, rootsUnder } from "../helpers/providerStoreRoots.js";
import {
  VIBE3_EXPORT_SHORT,
  VIBE3_PONG_STREAM,
  VIBE3_RESUME_STREAM,
  VIBE3_SESSION_ID,
  vibe3ExportText,
  vibe3StreamText,
} from "../helpers/vibe3Fixtures.js";
import { removeTempDir } from "../helpers/tempGit.js";

let root: string;
let home: string;
let tree: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "phax-transcript-stores-"));
  home = join(root, "home");
  tree = join(root, "worktrees", "invoice-export", "phase-02");
  mkdirSync(home, { recursive: true });
  mkdirSync(tree, { recursive: true });
  vi.stubEnv("HOME", home);
});

afterEach(() => {
  vi.unstubAllEnvs();
  // Undo any chmod 000 so the folder can be removed.
  chmodSync(root, 0o700);
  for (const dir of locked) chmodSync(dir, 0o700);
  locked.length = 0;
  removeTempDir(root);
});

const locked: string[] = [];

function lock(dir: string): void {
  chmodSync(dir, 0o000);
  locked.push(dir);
}

// A superuser reads through any mode, so the unreadable cases need a plain user.
const canLock = process.getuid?.() !== 0;

const STARTED_AT = "2026-10-24T10:00:00.000Z";
// Not valid UTF-8: a lone 0xff, 0xfe and a truncated two-byte sequence.
const INVALID_UTF8 = Uint8Array.from([0x7b, 0xff, 0xfe, 0x0a, 0xc3, 0x28, 0x7d, 0x0a]);

function writeBytes(path: string, bytes: Uint8Array | string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, bytes);
}

function capture(
  provider: ProviderId,
  sessionId: string,
  overrides: { cwd?: string; startedAt?: string; phaseFolder?: string } = {},
): Promise<TranscriptRead> {
  return Effect.flatMap(Backend, (backend) =>
    backend.captureTranscript({
      provider,
      sessionId,
      startedAt: overrides.startedAt ?? STARTED_AT,
      cwd: overrides.cwd ?? tree,
      phaseFolder: overrides.phaseFolder ?? phaseFolderOf(),
    }),
  ).pipe(
    Effect.provide(makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG)),
    Effect.provide(providerStoreRootsUnder(home)),
    Effect.runPromise,
  );
}

// The roots in context and the capture of session X1, under whatever layers are provided.
function rootsAndCapture(provider: ProviderId) {
  return Effect.gen(function* () {
    const backend = yield* Backend;
    return {
      roots: yield* ProviderStoreRoots,
      read: yield* backend.captureTranscript({
        provider,
        sessionId: "X1",
        startedAt: STARTED_AT,
        cwd: tree,
        phaseFolder: phaseFolderOf(),
      }),
    };
  });
}

function bytesOf(read: TranscriptRead): Uint8Array {
  expect(read.status).toBe("found");
  return read.status === "found" ? read.bytes : new Uint8Array();
}

const claudeProjects = () => join(home, ".claude", "projects");
const codexSessions = () => join(home, ".codex", "sessions");
// The folder a run's vibe turns keep their streams in.
const phaseFolderOf = () => join(root, "state", "runs", "invoice-export", "phase-02");

describe("captureTranscript on Claude Code", () => {
  it("finds the transcript by the worktree's raw slug", async () => {
    writeBytes(join(claudeProjects(), claudeProjectSlug(tree), "X1.jsonl"), '{"type":"init"}\n');

    expect(new TextDecoder().decode(bytesOf(await capture("claude-code", "X1")))).toBe(
      '{"type":"init"}\n',
    );
  });

  it("finds the transcript by the slug of the worktree's realpath", async () => {
    const link = join(root, "linked-tree");
    symlinkSync(tree, link);
    writeBytes(
      join(claudeProjects(), claudeProjectSlug(realpathSync(link)), "X1.jsonl"),
      "realpath\n",
    );

    const read = await capture("claude-code", "X1", { cwd: link });

    expect(new TextDecoder().decode(bytesOf(read))).toBe("realpath\n");
  });

  it("finds the transcript by listing the project folders", async () => {
    writeBytes(join(claudeProjects(), "-elsewhere-credit-notes", "X1.jsonl"), "listed\n");

    expect(new TextDecoder().decode(bytesOf(await capture("claude-code", "X1")))).toBe("listed\n");
  });

  it("returns the bytes exactly, invalid UTF-8 included", async () => {
    writeBytes(join(claudeProjects(), claudeProjectSlug(tree), "X1.jsonl"), INVALID_UTF8);

    expect(bytesOf(await capture("claude-code", "X1"))).toEqual(INVALID_UTF8);
  });

  it("is not-found with no transcript, or no store at all", async () => {
    expect(await capture("claude-code", "X1")).toMatchObject({
      status: "missing",
      reason: "not-found",
    });
    writeBytes(join(claudeProjects(), claudeProjectSlug(tree), "X0.jsonl"), "other\n");
    expect(await capture("claude-code", "X1")).toMatchObject({
      status: "missing",
      reason: "not-found",
    });
  });

  it.skipIf(!canLock)("is unreadable when the project folder cannot be read", async () => {
    const project = join(claudeProjects(), claudeProjectSlug(tree));
    writeBytes(join(project, "X1.jsonl"), "locked\n");
    lock(project);

    expect(await capture("claude-code", "X1")).toMatchObject({
      status: "missing",
      reason: "unreadable",
    });
  });
});

describe("captureTranscript on codex", () => {
  it("finds the rollout on its start date", async () => {
    writeBytes(join(codexSessions(), "2026/10/24/rollout-2026-10-24T10-00-00-X1.jsonl"), "day\n");

    expect(new TextDecoder().decode(bytesOf(await capture("codex-cli", "X1")))).toBe("day\n");
  });

  it("finds the rollout on the day after its start", async () => {
    writeBytes(join(codexSessions(), "2026/10/25/rollout-2026-10-25T00-10-00-X1.jsonl"), "next\n");

    const read = await capture("codex-cli", "X1", { startedAt: "2026-10-24T23:50:00.000Z" });

    expect(new TextDecoder().decode(bytesOf(read))).toBe("next\n");
  });

  it("walks the year, month and day folders when the start dates hold nothing", async () => {
    writeBytes(join(codexSessions(), "2026/01/02/rollout-2026-01-02T08-00-00-X1.jsonl"), "walk\n");

    expect(new TextDecoder().decode(bytesOf(await capture("codex-cli", "X1")))).toBe("walk\n");
  });

  it("does not take another session's rollout whose id ends the same way", async () => {
    writeBytes(join(codexSessions(), "2026/10/24/rollout-2026-10-24T10-00-00-AX1.jsonl"), "no\n");

    expect(await capture("codex-cli", "X1")).toMatchObject({
      status: "missing",
      reason: "not-found",
    });
  });

  it("returns the bytes exactly, invalid UTF-8 included", async () => {
    writeBytes(
      join(codexSessions(), "2026/10/24/rollout-2026-10-24T10-00-00-X1.jsonl"),
      INVALID_UTF8,
    );

    expect(bytesOf(await capture("codex-cli", "X1"))).toEqual(INVALID_UTF8);
  });

  it("is not-found with no rollout", async () => {
    expect(await capture("codex-cli", "X1")).toMatchObject({
      status: "missing",
      reason: "not-found",
    });
  });

  it.skipIf(!canLock)("is unreadable when the sessions folder cannot be read", async () => {
    writeBytes(join(codexSessions(), "2026/10/24/rollout-2026-10-24T10-00-00-X1.jsonl"), "x\n");
    lock(codexSessions());

    expect(await capture("codex-cli", "X1")).toMatchObject({
      status: "missing",
      reason: "unreadable",
    });
  });

  it("with CODEX_HOME deleted and HOME stubbed, reads only under the stubbed HOME", async () => {
    const elsewhere = join(root, "ci-codex-home");
    writeBytes(join(elsewhere, "sessions/2026/10/24/rollout-2026-10-24T10-00-00-X1.jsonl"), "ci\n");
    writeBytes(join(codexSessions(), "2026/10/24/rollout-2026-10-24T10-00-00-X1.jsonl"), "home\n");
    vi.stubEnv("CODEX_HOME", elsewhere);
    vi.stubEnv("CODEX_HOME", undefined);

    const { roots, read } = await rootsAndCapture("codex-cli").pipe(
      Effect.provide(makeProviderBackendLayer(DEFAULT_PROVIDER_CONFIG)),
      Effect.runPromise,
    );

    expect(roots.codex).toBe(join(home, ".codex"));
    expect(new TextDecoder().decode(bytesOf(read))).toBe("home\n");
  });
});

describe("captureTranscript on mistral-vibe", () => {
  const FIRST = vibe3StreamText(VIBE3_PONG_STREAM);
  const SECOND = vibe3StreamText(VIBE3_RESUME_STREAM);
  const keep = (name: string, bytes: Uint8Array | string): void =>
    writeBytes(join(phaseFolderOf(), name), bytes);
  const captured = async (sessionId = VIBE3_SESSION_ID) => capture("mistral-vibe", sessionId);

  it("is the session's kept turn streams concatenated in createdAt order, whatever their names", async () => {
    // The later turn sorts first by name: only createdAt orders them.
    keep("a-resume.jsonl", SECOND);
    keep("z-first.jsonl", FIRST);

    expect(new TextDecoder().decode(bytesOf(await captured()))).toBe(FIRST + SECOND);
  });

  it("keeps only the streams whose first entry names the session", async () => {
    const other = vibe3StreamText(VIBE3_PONG_STREAM).replaceAll(VIBE3_SESSION_ID, "other-session");
    keep("output.jsonl", FIRST);
    keep("fix-01.jsonl", other);

    expect(new TextDecoder().decode(bytesOf(await captured()))).toBe(FIRST);
    expect(new TextDecoder().decode(bytesOf(await captured("other-session")))).toBe(other);
  });

  it("lists the folder's own files only: interactive-transcripts and export directories are skipped", async () => {
    keep("output.jsonl", FIRST);
    keep(join("interactive-transcripts", `${VIBE3_SESSION_ID}.jsonl`), SECOND);
    keep(join("output.vibe-export", "nested.jsonl"), SECOND);

    expect(new TextDecoder().decode(bytesOf(await captured()))).toBe(FIRST);
  });

  it("returns the bytes exactly, invalid UTF-8 after the first entry included", async () => {
    const [firstLine] = FIRST.split("\n");
    const bytes = Uint8Array.from([...new TextEncoder().encode(`${firstLine}\n`), ...INVALID_UTF8]);
    keep("output.jsonl", bytes);

    expect(bytesOf(await captured())).toEqual(bytes);
  });

  it("is not-found when no kept stream names the session, as for one run in vibe's own interface", async () => {
    keep("output.jsonl", FIRST);
    keep("notes.jsonl", "not a vibe stream\n");

    expect(await captured("a-personal-session")).toMatchObject({
      status: "missing",
      reason: "not-found",
    });
  });

  it("is not-found when the phase folder is not there", async () => {
    expect(await captured()).toMatchObject({ status: "missing", reason: "not-found" });
  });

  it.skipIf(!canLock)("is unreadable when the phase folder cannot be read", async () => {
    keep("output.jsonl", FIRST);
    lock(phaseFolderOf());

    expect(await captured()).toMatchObject({ status: "missing", reason: "unreadable" });
  });

  it.skipIf(!canLock)("never reads vibe's home, whatever VIBE_HOME is", async () => {
    const vibeHome = join(root, "vibe-home");
    writeBytes(join(vibeHome, "logs", "session", "session_1", "messages.jsonl"), FIRST);
    vi.stubEnv("VIBE_HOME", vibeHome);
    lock(vibeHome);

    expect(await captured()).toMatchObject({ status: "missing", reason: "not-found" });
  });
});

describe("captureTranscript refuses an unsafe session id before building a path", () => {
  const providers: readonly ProviderId[] = ["claude-code", "codex-cli", "mistral-vibe"];
  it.each(
    providers.flatMap((provider) => [".", "..", "a/b", "../X1"].map((id) => ({ provider, id }))),
  )("$provider refuses $id", async ({ provider, id }) => {
    // A file the id would reach, were it joined into a path.
    writeBytes(join(home, ".claude", "X1.jsonl"), "escaped\n");

    expect(await capture(provider, id)).toEqual({
      status: "missing",
      reason: "unreadable",
      detail: "unsafe session id",
    });
  });
});

describe("the provider store roots of a command's layers", () => {
  const seedClaude = () =>
    writeBytes(join(claudeProjects(), claudeProjectSlug(tree), "X1.jsonl"), "kept\n");

  const probe = rootsAndCapture("claude-code");

  it("run and resume (provideRunLayers) provide ProviderStoreRootsLive to the backend and the use case", async () => {
    seedClaude();
    const config = { repoRoot: tree, stateRoot: join(root, "state") } as ResolvedConfig;

    const { roots, read } = await Effect.runPromise(
      provideRunLayers(probe, config, NoopSystemTelemetryLayer, DEFAULT_PROVIDER_CONFIG),
    );

    expect(roots).toEqual(rootsUnder(home));
    expect(new TextDecoder().decode(bytesOf(read))).toBe("kept\n");
  });

  it("the record writers' commands (makeProviderBackendLayer) provide it too", async () => {
    seedClaude();

    const { roots, read } = await Effect.runPromise(
      probe.pipe(Effect.provide(makeProviderBackendLayer(DEFAULT_PROVIDER_CONFIG))),
    );

    expect(roots).toEqual(rootsUnder(home));
    expect(read.status).toBe("found");
  });

  it("without it, the roots are the default and a capture reports missing", async () => {
    seedClaude();

    const { roots, read } = await Effect.runPromise(
      probe.pipe(Effect.provide(makeNodeBackendLayer(DEFAULT_PROVIDER_CONFIG))),
    );

    expect(roots).toEqual({ claude: null, codex: null });
    expect(read).toEqual({
      status: "missing",
      reason: "not-found",
      detail: "no provider store configured",
    });
  });
});

describe("record usage on mistral-vibe", () => {
  it("reads the export.json beside the phase's transcript, whatever the provider stores hold", async () => {
    writeBytes(
      join(tree, "output.vibe-export", "export.json"),
      vibe3ExportText(VIBE3_EXPORT_SHORT),
    );

    const usage = await Effect.runPromise(
      computeRecordUsage({
        provider: "mistral-vibe",
        folder: tree,
        sessionId: VIBE3_SESSION_ID,
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    expect(usage).toEqual({
      available: true,
      usage: {
        provider: "mistral-vibe",
        inputTokens: 10987,
        cachedInputTokens: 3200,
        outputTokens: 3,
        costUsd: 0.016503,
      },
    });
  });

  it("is unavailable when the turn wrote no export", async () => {
    const usage = await Effect.runPromise(
      computeRecordUsage({
        provider: "mistral-vibe",
        folder: tree,
        sessionId: VIBE3_SESSION_ID,
      }).pipe(Effect.provide(NodeFileSystemLayer)),
    );

    expect(usage).toEqual({ available: false });
  });
});

describe.each([
  {
    name: "node",
    make: (): { fs: FileSystemOps; modeOf: (path: string) => number | undefined } => ({
      fs: Effect.runSync(Effect.provide(FileSystem, NodeFileSystemLayer)),
      modeOf: (path) => statSync(path).mode & 0o777,
    }),
  },
  {
    name: "fake",
    make: (): { fs: FileSystemOps; modeOf: (path: string) => number | undefined } => {
      const { impl } = makeFakeFileSystem();
      return { fs: impl, modeOf: (path) => impl.modes.get(path) };
    },
  },
])("the $name FileSystem's bytes", ({ make }) => {
  it("round-trips bytes exactly through writeAtomicBytes and readBytes", async () => {
    const { fs } = make();
    const path = join(root, "copy", "X1.jsonl");

    await Effect.runPromise(fs.writeAtomicBytes(path, INVALID_UTF8));

    expect(await Effect.runPromise(fs.readBytes(path))).toEqual(INVALID_UTF8);
  });

  it("writes a copy with mode 0600 inside a 0700 interactive-transcripts folder", async () => {
    const { fs, modeOf } = make();
    const folder = join(root, "invoice-export", "phase-02", "interactive-transcripts");
    const path = join(folder, "X1.jsonl");

    await Effect.runPromise(fs.mkdirp(folder, { mode: 0o700 }));
    await Effect.runPromise(fs.writeAtomicBytes(path, INVALID_UTF8, { mode: 0o600 }));

    expect(modeOf(folder)).toBe(0o700);
    expect(modeOf(path)).toBe(0o600);
    expect(await Effect.runPromise(fs.readBytes(path))).toEqual(INVALID_UTF8);
  });

  it("overwrites an earlier copy", async () => {
    const { fs } = make();
    const path = join(root, "copy", "X1.jsonl");

    await Effect.runPromise(fs.writeAtomicBytes(path, INVALID_UTF8, { mode: 0o600 }));
    await Effect.runPromise(fs.writeAtomicBytes(path, Uint8Array.from([0x41]), { mode: 0o600 }));

    expect(await Effect.runPromise(fs.readBytes(path))).toEqual(Uint8Array.from([0x41]));
  });
});
