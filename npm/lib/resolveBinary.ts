// Binary names mirror RELEASE_TARGETS in scripts/build-binaries.ts
const BINARY_NAMES: Readonly<Record<string, Record<string, string>>> = {
  darwin: { arm64: "phax-darwin-arm64", x64: "phax-darwin-x64" },
  linux: { x64: "phax-linux-x64", arm64: "phax-linux-arm64" },
};

const GITHUB_REPO = "lbdremy/phax";

export function binaryName(platform: string, arch: string): string {
  const name = BINARY_NAMES[platform]?.[arch];
  if (name === undefined) {
    throw new Error(
      `Unsupported platform: ${platform}/${arch}. phax supports darwin and linux on arm64/x64 only.`,
    );
  }
  return name;
}

export function releaseAssetUrl(version: string, platform: string, arch: string): string {
  const name = binaryName(platform, arch);
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${name}`;
}
