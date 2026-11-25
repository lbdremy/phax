import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { EventEmitter } from "node:events";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadLauncher, startFixtureServer, testConfig } from "../helpers/launcherFixture.js";

const launcher = loadLauncher();
const NAME = "phax-darwin-arm64";
const BINARY = Buffer.from("#!/bin/sh\necho fake phax\n".repeat(64));
const DIGEST = createHash("sha256").update(BINARY).digest("hex");

type Server = Awaited<ReturnType<typeof startFixtureServer>>;

const servers: Server[] = [];
const homes: string[] = [];
const stubTimers: NodeJS.Timeout[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const timer of stubTimers.splice(0)) clearTimeout(timer);
  await Promise.all(servers.splice(0).map((server) => server.close()));
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

async function setup(overrides: Parameters<typeof testConfig>[2] = {}) {
  const server = await startFixtureServer();
  servers.push(server);
  const home = mkdtempSync(join(tmpdir(), "phax-launcher-dl-"));
  homes.push(home);
  const config = testConfig(home, server, overrides);
  const urls = launcher.releaseUrls(config, NAME);
  const binaryPath = new URL(urls.binary).pathname;
  const checksumPath = new URL(urls.checksum).pathname;
  const cache = launcher.cachePath(config, NAME);
  return {
    server,
    home,
    config,
    urls,
    binaryPath,
    checksumPath,
    cache,
    versionDir: dirname(cache),
  };
}

/** A request from {@link stubTransport}: it never answers, and its idle timer emits `timeout`. */
class StubRequest extends EventEmitter {
  destroyed = false;
  private idle: NodeJS.Timeout | undefined;

  setTimeout(ms: number): this {
    clearTimeout(this.idle);
    this.idle = setTimeout(() => this.emit("timeout"), ms);
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    clearTimeout(this.idle);
    return this;
  }
}

/**
 * A transport whose sockets start out connecting and complete (`connect`, or `secureConnect`
 * when `encrypted`) after `connectsAfterMs`, or never when it is null. No request is answered.
 */
function stubTransport(options: { encrypted: boolean; connectsAfterMs: number | null }) {
  const requests: StubRequest[] = [];
  return {
    requests,
    get(_url: string, _options: unknown, _onResponse: unknown): StubRequest {
      const req = new StubRequest();
      requests.push(req);
      const socket = Object.assign(new EventEmitter(), {
        connecting: true,
        encrypted: options.encrypted,
        unref: () => socket,
      });
      setImmediate(() => {
        req.emit("socket", socket);
        if (options.connectsAfterMs === null) return;
        stubTimers.push(
          setTimeout(() => {
            socket.connecting = false;
            socket.emit(options.encrypted ? "secureConnect" : "connect");
          }, options.connectsAfterMs),
        );
      });
      return req;
    },
  };
}

function sidecar(digest: string): string {
  return `${digest}  ${NAME}\n`;
}

/** The version directory's entries, or none when it does not exist. */
function listing(versionDir: string): string[] {
  return existsSync(versionDir) ? readdirSync(versionDir) : [];
}

function expectVerified(cache: string, versionDir: string): void {
  expect(statSync(cache).mode & 0o111).not.toBe(0);
  expect(createHash("sha256").update(readFileSync(cache)).digest("hex")).toBe(DIGEST);
  expect(listing(versionDir)).toEqual([NAME]);
}

describe("npm launcher download", () => {
  it("places one verified, executable binary at the cache path and nothing else", async () => {
    const t = await setup();
    t.server.route(t.binaryPath, { kind: "bytes", body: BINARY });
    t.server.route(t.checksumPath, { kind: "bytes", body: sidecar(DIGEST) });

    await expect(launcher.ensureBinary(t.config, NAME)).resolves.toBe(t.cache);
    expectVerified(t.cache, t.versionDir);
  });

  it("rejects a checksum mismatch and leaves nothing behind", async () => {
    const t = await setup();
    t.server.route(t.binaryPath, { kind: "bytes", body: BINARY });
    t.server.route(t.checksumPath, { kind: "bytes", body: sidecar("0".repeat(64)) });

    await expect(launcher.ensureBinary(t.config, NAME)).rejects.toThrow(
      `checksum mismatch for ${NAME}`,
    );
    expect(listing(t.versionDir)).toEqual([]);
  });

  it.each([
    ["a 404", { kind: "status", status: 404 } as const, "could not fetch checksum"],
    [
      "a line that is not 64 hex digits",
      { kind: "bytes", body: "not-a-digest  phax\n" } as const,
      "malformed checksum",
    ],
  ])(
    "rejects a sidecar answering %s, naming it, and leaves nothing",
    async (_label, route, reason) => {
      const t = await setup();
      t.server.route(t.binaryPath, { kind: "bytes", body: BINARY });
      t.server.route(t.checksumPath, route);

      const error: unknown = await launcher.ensureBinary(t.config, NAME).then(
        () => undefined,
        (err: unknown) => err,
      );
      expect(error).toBeInstanceOf(Error);
      const message = error instanceof Error ? error.message : "";
      expect(message).toContain(reason);
      expect(message).toContain(t.urls.checksum);
      expect(listing(t.versionDir)).toEqual([]);
    },
  );

  it("lets two concurrent first runs each verify their own copy", async () => {
    const t = await setup();
    t.server.route(t.binaryPath, { kind: "barrier", count: 2, body: BINARY });
    t.server.route(t.checksumPath, { kind: "bytes", body: sidecar(DIGEST) });

    const paths = await Promise.all([
      launcher.ensureBinary(t.config, NAME),
      launcher.ensureBinary(t.config, NAME),
    ]);
    expect(paths).toEqual([t.cache, t.cache]);
    expect(t.server.log.filter((entry) => entry.path === t.binaryPath)).toHaveLength(2);
    expect(t.server.log.filter((entry) => entry.path === t.checksumPath)).toHaveLength(2);
    expectVerified(t.cache, t.versionDir);
  });

  it("returns a binary already at the cache path without any request", async () => {
    const t = await setup();
    mkdirSync(t.versionDir, { recursive: true });
    writeFileSync(t.cache, BINARY, { mode: 0o755 });

    await expect(launcher.ensureBinary(t.config, NAME)).resolves.toBe(t.cache);
    expect(t.server.log).toEqual([]);
  });
});

describe("npm launcher redirects", () => {
  /** A chain of `hops` relative redirects from the binary path ending on the binary. */
  function chain(t: Awaited<ReturnType<typeof setup>>, hops: number): void {
    t.server.route(t.binaryPath, { kind: "redirect", status: 302, location: "/hop/1" });
    for (let i = 1; i < hops; i++) {
      t.server.route(`/hop/${i}`, { kind: "redirect", status: 302, location: `/hop/${i + 1}` });
    }
    t.server.route(`/hop/${hops}`, { kind: "bytes", body: BINARY });
    t.server.route(t.checksumPath, { kind: "bytes", body: sidecar(DIGEST) });
  }

  it("follows a chain of exactly the shipped bound of 5", async () => {
    const t = await setup();
    expect(t.config.maxRedirects).toBe(5);
    chain(t, 5);

    await expect(launcher.ensureBinary(t.config, NAME)).resolves.toBe(t.cache);
    expectVerified(t.cache, t.versionDir);
  });

  it("refuses a sixth redirect, naming the original URL and the bound", async () => {
    const t = await setup();
    chain(t, 6);

    await expect(launcher.ensureBinary(t.config, NAME)).rejects.toThrow(
      `download failed: more than 5 redirects from ${t.urls.binary}`,
    );
    expect(t.server.log.some((entry) => entry.path === "/hop/6")).toBe(false);
    expect(listing(t.versionDir)).toEqual([]);
  });

  it.each([301, 302, 303, 307, 308])("resolves a relative Location on %i", async (status) => {
    const t = await setup();
    t.server.route(t.binaryPath, { kind: "redirect", status, location: `../../assets/${status}` });
    t.server.route(`/releases/assets/${status}`, { kind: "bytes", body: BINARY });
    t.server.route(t.checksumPath, { kind: "bytes", body: sidecar(DIGEST) });

    await expect(launcher.ensureBinary(t.config, NAME)).resolves.toBe(t.cache);
    expect(t.server.log.map((entry) => entry.path)).toContain(`/releases/assets/${status}`);
    expectVerified(t.cache, t.versionDir);
  });

  it("never requests a refused redirect target", async () => {
    const t = await setup();
    const target = `http://localhost:${t.server.port}/elsewhere`;
    t.server.route(t.binaryPath, { kind: "redirect", status: 302, location: target });
    t.server.route("/elsewhere", { kind: "bytes", body: BINARY });

    await expect(launcher.ensureBinary(t.config, NAME)).rejects.toThrow(
      `download failed: refused redirect to ${target}: host is not 127.0.0.1`,
    );
    expect(t.server.log.some((entry) => entry.path === "/elsewhere")).toBe(false);
    expect(listing(t.versionDir)).toEqual([]);
  });
});

describe("npm launcher timeouts", () => {
  it("abandons a download that sends no data, naming the host, and leaves nothing", async () => {
    const t = await setup({ idleTimeoutMs: 200 });
    t.server.route(t.binaryPath, { kind: "hold" });

    await expect(launcher.ensureBinary(t.config, NAME)).rejects.toThrow(
      "download failed: no data from 127.0.0.1 for 0.2 s",
    );
    expect(listing(t.versionDir)).toEqual([]);
  });

  it("abandons a download whose body stops partway, naming the host, and leaves nothing", async () => {
    const t = await setup({ idleTimeoutMs: 200 });
    t.server.route(t.binaryPath, { kind: "partial", body: BINARY.subarray(0, 512) });

    await expect(launcher.ensureBinary(t.config, NAME)).rejects.toThrow(
      "download failed: no data from 127.0.0.1 for 0.2 s",
    );
    expect(listing(t.versionDir)).toEqual([]);
  });

  it("lets a slow but live download run past the connect timeout", async () => {
    const t = await setup({ connectTimeoutMs: 100, idleTimeoutMs: 2000 });
    t.server.route(t.binaryPath, { kind: "trickle", body: BINARY, chunks: 8, intervalMs: 40 });
    t.server.route(t.checksumPath, { kind: "bytes", body: sidecar(DIGEST) });

    await expect(launcher.ensureBinary(t.config, NAME)).resolves.toBe(t.cache);
    expectVerified(t.cache, t.versionDir);
  });

  it("abandons a connection that never completes, naming the host, and leaves nothing", async () => {
    const t = await setup({ connectTimeoutMs: 100 });
    const transport = stubTransport({ encrypted: false, connectsAfterMs: null });

    await expect(launcher.ensureBinary({ ...t.config, transport }, NAME)).rejects.toThrow(
      "download failed: no connection to 127.0.0.1 within 0.1 s",
    );
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.destroyed).toBe(true);
    expect(listing(t.versionDir)).toEqual([]);
  });

  it.each([
    { label: "a plain", encrypted: false },
    { label: "a TLS", encrypted: true },
  ])("stops the connect timer once $label connection completes", async ({ encrypted }) => {
    const t = await setup({ connectTimeoutMs: 100, idleTimeoutMs: 300 });
    const transport = stubTransport({ encrypted, connectsAfterMs: 20 });

    // Connected at 20 ms and silent after: the idle timeout ends it, not the connect timer.
    await expect(launcher.ensureBinary({ ...t.config, transport }, NAME)).rejects.toThrow(
      "download failed: no data from 127.0.0.1 for 0.3 s",
    );
    expect(listing(t.versionDir)).toEqual([]);
  });

  it("abandons an update check that never answers, silently and without a cache", async () => {
    const t = await setup({ updateTimeoutMs: 100 });
    t.server.route(new URL(t.config.updateUrl).pathname, { kind: "hold" });
    const stderr = vi.spyOn(process.stderr, "write");

    await expect(launcher.refreshUpdateCache(t.config)).resolves.toBeUndefined();
    expect(stderr).not.toHaveBeenCalled();
    expect(existsSync(join(t.home, ".phax", "bin", ".update-check.json"))).toBe(false);
  });
});
