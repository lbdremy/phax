// The release notes of a version, built from decoded facts. Pure: no file, no
// git and no process, so the Node test suite can typecheck and unit-test it.
// scripts/release-notes.ts gathers the input from git, the plans, the specs
// and docs/upgrading.md, and applies this module.
import { posix } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import type { Nodes, Root } from "mdast";
import {
  finishDocument,
  headingText,
  inlineCode,
  sentence,
} from "../src/domain/authoring/markdown.js";
import { SURFACE_SUMMARY_PLACEHOLDER } from "../src/schemas/specDocument.js";

export interface ReleaseNotesInput {
  readonly version: string; // the release, X.Y.Z
  readonly previous: string; // the previous release, X.Y.Z
  readonly repository: string; // e.g. https://github.com/lbdremy/phax, no trailing slash
  readonly upgrading: string; // the whole text of docs/upgrading.md
  readonly plans: ReadonlyArray<ReleasePlan>; // the plans the release's runs delivered, in run order
  readonly commits: ReadonlyArray<ReleaseCommit>; // the commits outside any announced run, oldest first
}

export interface ReleasePlan {
  readonly path: string; // repo-relative plan.md path, for messages
  readonly title: string; // the plan's # heading, plain text
  readonly firstParagraph: string; // the first paragraph under the title, raw Markdown
  readonly spec: ReleaseSpec | null; // null: the plan has no source spec
  readonly completesSpec: boolean; // the plan's completes-spec; false when spec is null
}

export interface ReleaseSpec {
  readonly path: string; // repo-relative spec .md path where it was found; identifies the spec
  readonly title: string;
  readonly guidingRule: string | null; // null when the spec has no sidecar
  readonly surface: ReadonlyArray<ReleaseSurface>; // empty when the spec has no sidecar
}

export interface ReleaseSurface {
  readonly surface: string;
  readonly summary: string;
  readonly before: string | null;
  readonly after: string;
}

export interface ReleaseCommit {
  readonly hash: string; // full 40-hex hash
  readonly subject: string;
}

export interface ReleaseNotes {
  readonly markdown: string;
  readonly warnings: ReadonlyArray<string>;
}

export const GITHUB_BODY_LIMIT = 125000;

const SITE = "https://docs.phax.run/releases";
const KEPT_SURFACE = /^(?:cli|config|file):/;
const SKIPPED_TYPES: ReadonlySet<string> = new Set([
  "test",
  "chore",
  "docs",
  "refactor",
  "style",
  "build",
  "ci",
]);

/** The conventional type of a subject, lower-cased; null for any other subject. */
export function commitType(subject: string): string | null {
  const match = /^([A-Za-z]+)(?:\([^()\n]*\))?!?: /.exec(subject);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Where a commit outside any run is listed. */
export function commitPlace(subject: string): "fixes" | "other" | "neither" {
  const type = commitType(subject);
  if (type === "fix") return "fixes";
  if (type !== null && SKIPPED_TYPES.has(type)) return "neither";
  return "other";
}

/** A backslash before each character a commit subject could turn into Markdown. */
export function escapeSubject(subject: string): string {
  return subject.replace(/[\\`*_[\]<>&~|]/g, "\\$&");
}

/** A `text` code fence one backtick longer than the longest run in the content. */
export function fenced(content: string): string {
  const longestRun = Math.max(0, ...Array.from(content.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${content}\n${fence}`;
}

/** The name of a spec: its title up to the first ` — `. */
export function specName(title: string): string {
  const cut = title.indexOf(" — ");
  return headingText(cut === -1 ? title : title.slice(0, cut));
}

/** The rest of a spec title as a sentence; null when the title has no ` — `. */
export function specLede(title: string): string | null {
  const cut = title.indexOf(" — ");
  if (cut === -1) return null;
  const rest = title.slice(cut + 3).trim();
  if (rest.length === 0) return null;
  const [first = ""] = Array.from(rest);
  return sentence(`${first.toUpperCase()}${rest.slice(first.length)}`);
}

/**
 * A link destination written in `source` (repo-relative), made absolute at the
 * tag: an anchor names `source`, a relative path resolves from `writtenAt`'s
 * folder. Null when it leaves the repository: the caller keeps it as written.
 */
export function absoluteDestination(
  destination: string,
  source: string,
  repository: string,
  version: string,
  writtenAt: string = source,
): string | null {
  if (destination === "" || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(destination)) return destination;
  const base = `${repository}/blob/v${version}/`;
  if (destination.startsWith("#")) return `${base}${source}${destination}`;
  const hash = destination.indexOf("#");
  const path = hash === -1 ? destination : destination.slice(0, hash);
  const fragment = hash === -1 ? "" : destination.slice(hash);
  const resolved = destination.startsWith("/")
    ? posix.normalize(path.replace(/^\/+/, ""))
    : posix.join(posix.dirname(writtenAt), path);
  const normalized = posix.normalize(resolved);
  if (normalized === ".." || normalized.startsWith("../")) return null;
  return `${base}${normalized}${fragment}`;
}

// An archived plan's links were written at its live path: the archive move
// keeps its text, so a relative destination resolves from docs/plans/.
function livePath(path: string): string {
  return path.replace(/^docs\/plans\/archive\//, "docs/plans/");
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function applyEdits(text: string, edits: ReadonlyArray<Edit>): string {
  return edits
    .toSorted((a, b) => b.start - a.start)
    .reduce((acc, e) => `${acc.slice(0, e.start)}${e.text}${acc.slice(e.end)}`, text);
}

function walk(node: Nodes, visit: (node: Nodes) => void): void {
  visit(node);
  if ("children" in node) for (const child of node.children) walk(child, visit);
}

/** `text` with every link destination, inline or in a definition, made absolute. */
export function absolutizeLinks(
  text: string,
  source: string,
  repository: string,
  version: string,
  warnings: string[],
  writtenAt: string = source,
): string {
  const tree: Root = fromMarkdown(text);
  const edits: Edit[] = [];
  walk(tree, (node) => {
    if (node.type !== "link" && node.type !== "image" && node.type !== "definition") return;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || node.url === "") return;
    const raw = text.slice(start, end);
    const marker = node.type === "definition" ? "]:" : "](";
    let from = 0;
    if (node.type === "link" && node.children.length > 0) {
      const last = node.children[node.children.length - 1]?.position?.end.offset;
      from = last === undefined ? 0 : last - start;
    }
    const open = raw.indexOf(marker, from);
    const at = raw.indexOf(node.url, open === -1 ? from : open);
    if (at === -1) return;
    const replacement = absoluteDestination(node.url, source, repository, version, writtenAt);
    if (replacement === null) {
      warnings.push(`${source}: the link ${node.url} leaves the repository and is kept as written`);
      return;
    }
    if (replacement === node.url) return;
    edits.push({ start: start + at, end: start + at + node.url.length, text: replacement });
  });
  return applyEdits(text, edits);
}

/** The lines under the `### <version>` heading; null when there is none. */
function upgradingEntry(upgrading: string, version: string): string | null {
  const children = fromMarkdown(upgrading).children;
  const index = children.findIndex(
    (node) => node.type === "heading" && node.depth === 3 && toString(node).trim() === version,
  );
  const from = children[index]?.position?.end.offset;
  if (from === undefined) return null;
  const next = children.slice(index + 1).find((node) => node.type === "heading" && node.depth <= 3);
  const to = next?.position?.start.offset ?? upgrading.length;
  return upgrading
    .slice(from, to)
    .replace(/^(?:[ \t]*\r?\n)+/, "")
    .replace(/(?:\r?\n[ \t]*)+$/, "");
}

function surfaceBlocks(surface: ReleaseSurface): string[] {
  const summary = surface.before === null ? "After" : "Before and after";
  const content =
    surface.before === null
      ? [fenced(surface.after)]
      : ["Before:", fenced(surface.before), "After:", fenced(surface.after)];
  return [
    `${inlineCode(surface.surface)} — ${surface.summary}`,
    `<details>\n<summary>${summary}</summary>\n\n${content.join("\n\n")}\n\n</details>`,
  ];
}

function checkRefusals(plans: ReadonlyArray<ReleasePlan>): void {
  const announced = new Map<string, ReleasePlan>();
  for (const plan of plans) {
    if (plan.spec === null || !plan.completesSpec) continue;
    const first = announced.get(plan.spec.path);
    if (first !== undefined) {
      throw new Error(
        `${plan.spec.path} is announced in full twice: ${first.path} and ${plan.path} both say completes-spec: true`,
      );
    }
    announced.set(plan.spec.path, plan);
  }
  for (const plan of plans) {
    if (plan.spec === null || !plan.completesSpec) continue;
    for (const element of plan.spec.surface) {
      if (KEPT_SURFACE.test(element.surface) && element.summary === SURFACE_SUMMARY_PLACEHOLDER) {
        throw new Error(
          `${plan.spec.path}: the surface element "${element.surface}" still has the placeholder summary — write it before the release`,
        );
      }
    }
  }
}

function specBlocks(spec: ReleaseSpec, plans: ReadonlyArray<ReleasePlan>): string[] {
  const lede = specLede(spec.title);
  const titles = plans.filter((plan) => plan.spec?.path === spec.path).map((p) => p.title);
  return [
    `### ${specName(spec.title)}`,
    ...(lede === null ? [] : [lede]),
    ...(spec.guidingRule === null
      ? []
      : [
          spec.guidingRule
            .split(/\r\n?|\n/)
            .map((line) => (line === "" ? ">" : `> ${line}`))
            .join("\n"),
        ]),
    sentence(`Plans: ${titles.map(headingText).join(", ")}`),
    ...spec.surface.filter((e) => KEPT_SURFACE.test(e.surface)).flatMap(surfaceBlocks),
  ];
}

function commitItem(commit: ReleaseCommit, repository: string): string {
  return `- ${escapeSubject(commit.subject)} ([${commit.hash.slice(0, 7)}](${repository}/commit/${commit.hash}))`;
}

export function renderReleaseNotes(input: ReleaseNotesInput): ReleaseNotes {
  const { version, previous, repository, plans } = input;
  checkRefusals(plans);
  const warnings: string[] = [];
  const blocks: string[] = [
    `# phax ${version}`,
    `Changes since ${previous}: [v${previous}...v${version}](${repository}/compare/v${previous}...v${version}).`,
  ];

  const entry = upgradingEntry(input.upgrading, version);
  if (entry === null) {
    warnings.push(
      `docs/upgrading.md has no "### ${version}" entry: the notes have no Upgrading section`,
    );
  } else {
    blocks.push(
      "## Upgrading",
      absolutizeLinks(entry, "docs/upgrading.md", repository, version, warnings),
    );
  }

  const full = plans.filter((plan) => plan.spec !== null && plan.completesSpec);
  if (full.length > 0) {
    blocks.push("## Specs");
    for (const plan of full) {
      if (plan.spec !== null) blocks.push(...specBlocks(plan.spec, plans));
    }
  }

  const announced = new Set(full.map((plan) => plan.spec?.path));
  const inProgress = plans.filter(
    (plan) => plan.spec !== null && !plan.completesSpec && !announced.has(plan.spec.path),
  );
  if (inProgress.length > 0) {
    blocks.push(
      "## Specs in progress",
      inProgress
        .map((plan) => `- Part of ${specName(plan.spec?.title ?? "")}: ${headingText(plan.title)}`)
        .join("\n"),
    );
  }

  const loose = plans.filter((plan) => plan.spec === null);
  if (loose.length > 0) {
    blocks.push("## Plans");
    for (const plan of loose) {
      blocks.push(
        `### ${headingText(plan.title)}`,
        absolutizeLinks(
          plan.firstParagraph,
          plan.path,
          repository,
          version,
          warnings,
          livePath(plan.path),
        ),
      );
    }
  }

  for (const [place, heading] of [
    ["fixes", "## Fixes"],
    ["other", "## Other"],
  ] as const) {
    const items = input.commits
      .filter((commit) => commitPlace(commit.subject) === place)
      .map((commit) => commitItem(commit, repository));
    if (items.length > 0) blocks.push(heading, items.join("\n"));
  }

  return { markdown: finishDocument(blocks), warnings };
}

export function githubReleaseBody(markdown: string, version: string): string {
  const edits: Edit[] = [];
  let opening: number | null = null;
  let linkAt: number | null = null;
  for (const node of fromMarkdown(markdown).children) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    if (opening === null) {
      if (node.type === "html" && node.value.startsWith("<details>")) opening = start;
      else if (
        linkAt === null &&
        node.type === "paragraph" &&
        toString(node).startsWith("Changes since ")
      ) {
        linkAt = end;
      }
    } else if (node.type === "html" && node.value === "</details>") {
      const blank = /\r?\n[ \t]*\r?\n$/.exec(markdown.slice(0, opening))?.[0].length ?? 0;
      edits.push({ start: opening - blank, end, text: "" });
      opening = null;
    }
  }
  if (linkAt === null) throw new Error('the notes have no "Changes since" paragraph');
  const slug = version.replace(/\./g, "-");
  edits.push({
    start: linkAt,
    end: linkAt,
    text: `\n\nRead the full notes, with each surface's before and after, on [docs.phax.run/releases/${slug}](${SITE}/${slug}).`,
  });
  const body = `${applyEdits(markdown, edits).replace(/\n+$/, "")}\n`;
  const length = Array.from(body).length;
  if (length > GITHUB_BODY_LIMIT) {
    throw new Error(
      `the GitHub release body of ${version} has ${length} characters, over GitHub's limit of ${GITHUB_BODY_LIMIT} — shorten the notes`,
    );
  }
  return body;
}
