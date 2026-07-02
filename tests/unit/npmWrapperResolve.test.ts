import { describe, expect, it } from "vitest";
import { binaryName, checksumAssetUrl, releaseAssetUrl } from "../../npm/lib/resolveBinary.ts";

describe("binaryName", () => {
  it.each([
    ["darwin", "arm64", "phax-darwin-arm64"],
    ["darwin", "x64", "phax-darwin-x64"],
    ["linux", "x64", "phax-linux-x64"],
    ["linux", "arm64", "phax-linux-arm64"],
  ] as const)("maps %s/%s to %s", (platform, arch, expected) => {
    expect(binaryName(platform, arch)).toBe(expected);
  });

  it("throws for win32", () => {
    expect(() => binaryName("win32", "x64")).toThrow(/[Uu]nsupported/);
  });

  it("throws for unknown platform", () => {
    expect(() => binaryName("freebsd", "x64")).toThrow(/[Uu]nsupported/);
  });
});

describe("releaseAssetUrl", () => {
  it.each([
    ["darwin", "arm64"],
    ["darwin", "x64"],
    ["linux", "x64"],
    ["linux", "arm64"],
  ] as const)("embeds v<version> and asset name for %s/%s", (platform, arch) => {
    const url = releaseAssetUrl("0.1.0", platform, arch);
    expect(url).toContain("v0.1.0");
    expect(url).toContain(binaryName(platform, arch));
    expect(url).toMatch(/^https:\/\/github\.com\//);
  });

  it("uses the correct version tag format", () => {
    const url = releaseAssetUrl("1.2.3", "darwin", "arm64");
    expect(url).toContain("/v1.2.3/");
  });

  it("throws for unsupported platform", () => {
    expect(() => releaseAssetUrl("0.1.0", "win32", "x64")).toThrow(/[Uu]nsupported/);
  });
});

describe("checksumAssetUrl", () => {
  it("appends .sha256 to the release asset url", () => {
    const url = checksumAssetUrl("1.2.3", "darwin", "arm64");
    expect(url).toBe(`${releaseAssetUrl("1.2.3", "darwin", "arm64")}.sha256`);
    expect(url).toMatch(/\.sha256$/);
  });

  it("throws for unsupported platform", () => {
    expect(() => checksumAssetUrl("0.1.0", "win32", "x64")).toThrow(/[Uu]nsupported/);
  });
});
