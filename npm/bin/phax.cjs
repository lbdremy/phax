#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");
const os = require("os");

// Binary names mirror RELEASE_TARGETS in scripts/build-binaries.ts
// and resolveBinary.ts in npm/lib/
const BINARY_NAMES = {
  darwin: { arm64: "phax-darwin-arm64", x64: "phax-darwin-x64" },
  linux: { x64: "phax-linux-x64", arm64: "phax-linux-arm64" },
};

const GITHUB_REPO = "lbdremy/phax";
const VERSION = require("../package.json").version;

function getBinaryName(platform, arch) {
  const name = BINARY_NAMES[platform] && BINARY_NAMES[platform][arch];
  if (!name) {
    throw new Error(
      `Unsupported platform: ${platform}/${arch}. phax supports darwin and linux on arm64/x64 only.`,
    );
  }
  return name;
}

function getReleaseUrl(version, platform, arch) {
  const name = getBinaryName(platform, arch);
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${name}`;
}

function getCachePath(name) {
  return path.join(os.homedir(), ".phax", "bin", name);
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + ".tmp";
    const file = fs.createWriteStream(tmp);

    function get(u) {
      https
        .get(u, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            res.resume();
            get(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            file.close();
            fs.unlink(tmp, () => {});
            reject(new Error(`Download failed: HTTP ${res.statusCode} for ${u}`));
            return;
          }
          res.pipe(file);
          file.on("finish", () => {
            file.close(() => {
              fs.rename(tmp, dest, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          });
          file.on("error", (err) => {
            fs.unlink(tmp, () => {});
            reject(err);
          });
        })
        .on("error", (err) => {
          fs.unlink(tmp, () => {});
          reject(err);
        });
    }

    get(url);
  });
}

async function main() {
  const platform = process.platform;
  const arch = process.arch;
  const name = getBinaryName(platform, arch);
  const binPath = getCachePath(name);

  if (!fs.existsSync(binPath)) {
    const url = getReleaseUrl(VERSION, platform, arch);
    process.stderr.write(`phax: downloading binary from ${url}\n`);
    fs.mkdirSync(path.dirname(binPath), { recursive: true });
    await download(url, binPath);
    fs.chmodSync(binPath, 0o755);
  }

  const result = spawnSync(binPath, process.argv.slice(2), { stdio: "inherit" });
  process.exit(result.status ?? 1);
}

main().catch((err) => {
  process.stderr.write(`phax: ${err.message}\n`);
  process.exit(1);
});
