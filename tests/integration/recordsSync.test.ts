import { mkdtempSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import { NodeGitLayer } from "../../src/infra/git.js";
import { NodeFileSystemLayer } from "../../src/infra/fs.js";
import { Git, type GitError } from "../../src/ports/git.js";
import { FileSystem, type FsError } from "../../src/ports/fs.js";
import {
  checkRecordsRunPreflight,
  reconcileRecordsSync,
  recordsClonePath,
  type RecordsRunPreflightResult,
  type RecordsSyncResult,
} from "../../src/app/recordsSync.js";
import type { ResolvedRecordsConfig } from "../../src/schemas/recordsConfig.js";

const LAYER = Layer.mergeAll(NodeFileSystemLayer, NodeGitLayer);

function run<A>(effect: Effect.Effect<A, GitError | FsError, Git | FileSystem>): Promise<A> {
  return Effect.runPromise(Effect.provide(effect, LAYER));
}

function git(args: readonly string[], cwd: string): string {
  return execFileSync("git", [...args], { cwd, encoding: "utf8" });
}

function repoConfig(remote: string): ResolvedRecordsConfig {
  return {
    enabled: true,
    transcript: true,
    destination: { kind: "repo", remote },
    autoPush: false,
  };
}

const IN_REPO_CONFIG: ResolvedRecordsConfig = {
  enabled: true,
  transcript: true,
  destination: { kind: "in-repo" },
  autoPush: false,
};

const OFF_CONFIG: ResolvedRecordsConfig = {
  enabled: false,
  transcript: false,
  destination: { kind: "in-repo" },
  autoPush: false,
};

describe("recordsSync", () => {
  let stateRoot: string;
  let remoteDir: string;
  const namespace = "acme";

  beforeEach(() => {
    stateRoot = mkdtempSync(join(tmpdir(), "phax-records-sync-state-"));
    remoteDir = mkdtempSync(join(tmpdir(), "phax-records-sync-remote-"));
    git(["init", "--bare"], remoteDir);
  });

  afterEach(async () => {
    await rm(stateRoot, { recursive: true, force: true });
    await rm(remoteDir, { recursive: true, force: true });
  });

  describe("reconcileRecordsSync", () => {
    it("does nothing to bootstrap for an in-repo destination", async () => {
      const result = await run(
        reconcileRecordsSync({ records: IN_REPO_CONFIG, stateRoot, namespace }),
      );
      expect(result).toEqual({ kind: "nothing-to-bootstrap" });
    });

    it("clones when no local clone exists, and fetches rather than re-cloning on a second call", async () => {
      const config = repoConfig(remoteDir);
      const path = recordsClonePath(stateRoot, namespace);

      const first = await run(reconcileRecordsSync({ records: config, stateRoot, namespace }));
      expect(first).toEqual({ kind: "cloned", path, remote: remoteDir });
      expect(git(["remote", "get-url", "origin"], path).trim()).toBe(remoteDir);

      const second = await run(reconcileRecordsSync({ records: config, stateRoot, namespace }));
      expect(second).toEqual({ kind: "fetched", path, remote: remoteDir });
    });

    it("refuses a local clone whose origin differs, leaving it untouched", async () => {
      const otherRemote = mkdtempSync(join(tmpdir(), "phax-records-sync-other-remote-"));
      git(["init", "--bare"], otherRemote);
      const path = recordsClonePath(stateRoot, namespace);
      await mkdir(join(stateRoot, "records"), { recursive: true });
      git(["clone", "--", otherRemote, path], stateRoot);
      const statusBefore = git(["status", "--porcelain"], path);

      const config = repoConfig(remoteDir);
      const result = await run(reconcileRecordsSync({ records: config, stateRoot, namespace }));

      expect(result).toEqual({
        kind: "refused",
        reason: "origin-mismatch",
        path,
        remote: remoteDir,
        message: expect.stringContaining(otherRemote),
        remedy: expect.any(String),
      });
      expect(git(["remote", "get-url", "origin"], path).trim()).toBe(otherRemote);
      expect(git(["status", "--porcelain"], path)).toBe(statusBefore);

      await rm(otherRemote, { recursive: true, force: true });
    });

    it("refuses a local-only repo holding commits with no origin remote", async () => {
      const path = recordsClonePath(stateRoot, namespace);
      await mkdir(path, { recursive: true });
      git(["init"], path);
      git(["config", "--local", "user.email", "test@phax.test"], path);
      git(["config", "--local", "user.name", "phax test"], path);
      await writeFile(join(path, "README.md"), "# local only\n");
      git(["add", "."], path);
      git(["commit", "-m", "chore: local only"], path);

      const config = repoConfig(remoteDir);
      const result: RecordsSyncResult = await run(
        reconcileRecordsSync({ records: config, stateRoot, namespace }),
      );

      expect(result).toEqual({
        kind: "refused",
        reason: "local-only-history",
        path,
        remote: remoteDir,
        message: expect.any(String),
        remedy: expect.any(String),
      });
    });
  });

  describe("checkRecordsRunPreflight", () => {
    it("refuses a run for a dedicated destination with no local clone, naming the command and destination", async () => {
      const config = repoConfig(remoteDir);
      const result: RecordsRunPreflightResult = await run(
        checkRecordsRunPreflight({ records: config, stateRoot, namespace }),
      );

      expect(result.kind).toBe("refused");
      if (result.kind === "refused") {
        expect(result.message).toContain("phax records sync");
        expect(result.message).toContain(remoteDir);
      }
    });

    it("passes once the local clone exists", async () => {
      const config = repoConfig(remoteDir);
      await run(reconcileRecordsSync({ records: config, stateRoot, namespace }));

      const result = await run(checkRecordsRunPreflight({ records: config, stateRoot, namespace }));
      expect(result).toEqual({ kind: "ok" });
    });

    it("passes for an in-repo destination and for records disabled, with no clone required", async () => {
      const inRepo = await run(
        checkRecordsRunPreflight({ records: IN_REPO_CONFIG, stateRoot, namespace }),
      );
      expect(inRepo).toEqual({ kind: "ok" });

      const off = await run(
        checkRecordsRunPreflight({ records: OFF_CONFIG, stateRoot, namespace }),
      );
      expect(off).toEqual({ kind: "ok" });
    });
  });
});
