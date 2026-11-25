import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import https from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LAUNCHER_SOURCE, loadLauncher } from "../helpers/launcherFixture.js";

const launcher = loadLauncher();

describe("npm launcher: binary names", () => {
  it.each([
    ["darwin", "arm64", "phax-darwin-arm64"],
    ["darwin", "x64", "phax-darwin-x64"],
    ["linux", "x64", "phax-linux-x64"],
    ["linux", "arm64", "phax-linux-arm64"],
  ] as const)("maps %s/%s to %s", (platform, arch, expected) => {
    expect(launcher.getBinaryName(platform, arch)).toBe(expected);
  });

  it.each([
    ["win32", "x64"],
    ["freebsd", "x64"],
  ] as const)("refuses %s/%s", (platform, arch) => {
    expect(() => launcher.getBinaryName(platform, arch)).toThrow(/Unsupported platform/);
  });
});

describe("npm launcher: production values", () => {
  it("talks https to the GitHub hosts with the shipped bounds", () => {
    const config = launcher.productionConfig();
    expect(config.transport).toBe(https);
    expect(config.scheme).toBe("https:");
    expect(config.allowedHosts).toEqual({
      exact: ["github.com", "api.github.com"],
      suffixes: ["githubusercontent.com"],
    });
    expect(config.maxRedirects).toBe(5);
    expect(config.connectTimeoutMs).toBe(10_000);
    expect(config.idleTimeoutMs).toBe(30_000);
    expect(config.updateTimeoutMs).toBe(5_000);
    expect(config.releaseBase).toBe("https://github.com/lbdremy/phax/releases/download");
    expect(config.updateUrl).toBe("https://api.github.com/repos/lbdremy/phax/releases/latest");
  });

  it("returns a fresh object on every call", () => {
    expect(launcher.productionConfig()).not.toBe(launcher.productionConfig());
  });
});

describe("npm launcher: checkRedirect with the shipped config", () => {
  const config = launcher.productionConfig();
  const from = "https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64";

  it.each([
    [
      "http://release-assets.githubusercontent.com/x",
      /refused redirect to http:\/\/release-assets\.githubusercontent\.com\/x: not https/,
    ],
    [
      "https://downloads.example.net/x",
      /refused redirect to https:\/\/downloads\.example\.net\/x: host is not github\.com or api\.github\.com or \*\.githubusercontent\.com/,
    ],
    [
      "https://githubusercontent.com.evil.net/x",
      /refused redirect to https:\/\/githubusercontent\.com\.evil\.net\/x/,
    ],
  ])("refuses %s, naming it", (location, message) => {
    expect(() => launcher.checkRedirect(config, from, location)).toThrow(message);
  });

  it("accepts https on release-assets.githubusercontent.com", () => {
    expect(
      launcher.checkRedirect(config, from, "https://release-assets.githubusercontent.com/x"),
    ).toBe("https://release-assets.githubusercontent.com/x");
  });

  it("resolves a relative Location against the redirecting URL", () => {
    expect(launcher.checkRedirect(config, from, "../v0.44.1/asset")).toBe(
      "https://github.com/lbdremy/phax/releases/download/v0.44.1/asset",
    );
  });
});

describe("npm launcher: fixed download source", () => {
  let home: string | undefined;

  afterEach(() => {
    vi.unstubAllEnvs();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
    home = undefined;
  });

  it("downloads the GitHub release asset and its .sha256 whatever the environment", () => {
    home = mkdtempSync(join(tmpdir(), "phax-launcher-env-"));
    vi.stubEnv("HOME", home);
    vi.stubEnv("PHAX_DOWNLOAD_URL", "https://downloads.example.net/phax");
    vi.stubEnv("HTTPS_PROXY", "http://proxy.example.net:3128");

    const urls = launcher.releaseUrls(
      { ...launcher.productionConfig(), version: "0.44.0" },
      "phax-darwin-arm64",
    );
    expect(urls).toEqual({
      binary: "https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64",
      checksum:
        "https://github.com/lbdremy/phax/releases/download/v0.44.0/phax-darwin-arm64.sha256",
    });
  });

  it("reads no process.env", () => {
    // Past the shebang (`#!/usr/bin/env node`), the source names no `env` in any form
    // (`process.env`, `const { env } = process`, `require("node:process").env`) and indexes
    // `process` by no computed key (`process["env"]`).
    const body = readFileSync(LAUNCHER_SOURCE, "utf8").split("\n").slice(1).join("\n");
    expect(body).not.toMatch(/\benv\b/);
    expect(body).not.toMatch(/process\s*\[/);
  });
});
