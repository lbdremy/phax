import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteLinks, repositoryOf, type LinkTargets } from "../../../site/build/links.js";
import { transformMarkdown } from "../../../site/build/markdown.js";
import { isFilePage, isRendered, releaseNotePages } from "../../../site/build/pageMap.js";
import pageMap from "../../../site/pages.js";
import { README, readSources, splitReadme } from "../../../site/build/sources.js";
import { isolateGit } from "../../helpers/isolateGit.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const NOTES_DIRECTORY = join(ROOT, "docs/releases");

const notesFiles = existsSync(NOTES_DIRECTORY)
  ? readdirSync(NOTES_DIRECTORY)
      .filter((name) => name.endsWith(".md"))
      .toSorted()
  : [];

/** Every repository file, tracked or not but never ignored: what a relative link may name. */
function repositoryFiles(): ReadonlyArray<string> {
  // Git away from the person's configuration: a global excludesFile would
  // otherwise decide which untracked files a link may name.
  const restoreGit = isolateGit();
  try {
    return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\0")
      .filter((path) => path !== "");
  } finally {
    restoreGit();
  }
}

/** The link targets the way site/build/generate.ts builds them for the real repository. */
function realTargets(): LinkTargets {
  const files = readSources(ROOT);
  const version = (
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      readonly version: string;
    }
  ).version;
  const map = {
    ...pageMap,
    files: [...pageMap.files, ...releaseNotePages([...files.keys()]).pages],
  };
  const headings = new Map(
    [...files.keys()]
      .filter((path) =>
        path === README
          ? true
          : map.files
              .filter(isFilePage)
              .some((page) => page.source === path && isRendered(page, version)),
      )
      .map((path) => [path, transformMarkdown(path, files.get(path) ?? "").headings] as const),
  );
  return {
    pageMap: map,
    version,
    repository: repositoryOf(repositoryFiles()),
    headings,
    readmeSections: splitReadme(files.get(README) ?? ""),
  };
}

describe("the real release notes", () => {
  // Also keeps the suite non-empty until the first cut writes docs/releases/.
  it("refuses a made-up notes file with a link to no file", () => {
    const path = "docs/releases/0.0.0.md";
    const text = "# phax 0.0.0\n\nSee [the guide](../no-such-guide.md).\n";
    const rewrite = rewriteLinks(path, text, realTargets());
    expect(rewrite.findings.map((finding) => finding.message)).toEqual([
      expect.stringContaining(`✗ ${path}:3: ../no-such-guide.md`),
    ]);
  });

  it.each(notesFiles)("docs/releases/%s has no link the site build would refuse", (name) => {
    const path = `docs/releases/${name}`;
    const text = readFileSync(join(ROOT, path), "utf8").replaceAll("\r\n", "\n");
    const rewrite = rewriteLinks(path, text, realTargets());
    expect(rewrite.findings.map((finding) => finding.message)).toEqual([]);
  });
});
