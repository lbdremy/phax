// Link rewriting and the broken-link check for the docs site. Every link,
// reference definition and image in a rendered source is resolved against the
// repository: a link to rendered content becomes its route and anchor, a link
// to any other repository file goes to GitHub at the release tag, a link to a
// held source becomes its plain text, and a missing file or anchor is a
// finding naming the source file, line and link. Rewrites are offset edits on
// the source, like markdown.ts's, so unrelated bytes stay as written.
import { posix } from "node:path";
import type { Definition, Image, ImageReference, Link, LinkReference, Nodes } from "mdast";
import type { Edit, MarkdownFinding, SourceHeading } from "./markdown.js";
import { parseMarkdown } from "./markdown.js";
import {
  INTRO,
  isFilePage,
  isReadmePage,
  isRendered,
  type FileEntry,
  type PageMap,
  type ReadmeEntry,
} from "./pageMap.js";
import { README, type ReadmeSection } from "./sources.js";

/** What exists in the repository, by `/`-separated path relative to its root (`""` is the root). */
export interface RepositoryIndex {
  readonly kind: (path: string) => "file" | "directory" | undefined;
}

/** An in-memory repository holding `paths` as files, and every ancestor as a directory. */
export function repositoryOf(paths: Iterable<string>): RepositoryIndex {
  const files = new Set(paths);
  const directories = new Set([""]);
  for (const path of files) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index++) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return {
    kind: (path) => (files.has(path) ? "file" : directories.has(path) ? "directory" : undefined),
  };
}

/** A link rewritten to a site route; site/generated/links.json lists them for the post-build check. */
export interface SiteLink {
  readonly source: string;
  readonly line: number;
  /** The link as the source wrote it. */
  readonly link: string;
  readonly route: string;
  /** The decoded anchor the target route's page must carry as an id, if any. */
  readonly anchor: string | null;
}

/** What resolving a link needs to know about the site being built. */
export interface LinkTargets {
  readonly pageMap: PageMap;
  readonly version: string;
  readonly repository: RepositoryIndex;
  /** GitHub heading ids of README.md and of every rendered file, by source path. */
  readonly headings: ReadonlyMap<string, ReadonlyArray<SourceHeading>>;
  readonly readmeSections: ReadonlyArray<ReadmeSection>;
}

export interface LinkRewrite {
  readonly edits: ReadonlyArray<Edit>;
  readonly links: ReadonlyArray<SiteLink>;
  readonly findings: ReadonlyArray<MarkdownFinding>;
  /** Links to a source held in this build, replaced by their text. */
  readonly held: number;
}

/** `<repository>/blob/v<version>`: where links to unrendered files point. */
export function blobBase(map: PageMap, version: string): string {
  return `${map.repository}/blob/v${version}`;
}

type Resolution =
  | { readonly kind: "unchanged" }
  | { readonly kind: "site"; readonly route: string; readonly anchor: string | null }
  | { readonly kind: "url"; readonly url: string }
  | { readonly kind: "text" }
  | { readonly kind: "broken"; readonly reason: string };

interface Range {
  readonly start: number;
  readonly end: number;
}

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isExternal(url: string): boolean {
  return url === "" || SCHEME.test(url) || url.startsWith("//");
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** A destination as Markdown accepts it: in angle brackets when it holds spaces or parentheses. */
function destination(url: string): string {
  return /[\s()<>]/.test(url) ? `<${url}>` : url;
}

function isSpace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n";
}

/** The range of the link destination starting at or after `index` (whitespace skipped). */
function destinationRange(text: string, index: number): Range {
  let cursor = index;
  while (cursor < text.length && isSpace(text.charAt(cursor))) cursor++;
  const start = cursor;
  if (text.charAt(cursor) === "<") {
    const close = text.indexOf(">", cursor + 1);
    return { start, end: close === -1 ? text.length : close + 1 };
  }
  let depth = 0;
  for (; cursor < text.length; cursor++) {
    const char = text.charAt(cursor);
    if (char === "\\") {
      cursor++;
      continue;
    }
    if (isSpace(char)) break;
    if (char === "(") depth++;
    if (char === ")") {
      if (depth === 0) break;
      depth--;
    }
  }
  return { start, end: cursor };
}

/** The offset of the `]` closing a link's or reference's label. */
function labelClose(node: Link | LinkReference, text: string): number {
  let cursor = node.children.at(-1)?.position?.end.offset ?? (node.position?.start.offset ?? 0) + 1;
  while (cursor < text.length && isSpace(text.charAt(cursor))) cursor++;
  return cursor;
}

/** The offset of the `]` closing a definition's label (`[label]: url`). */
function definitionLabelClose(text: string, start: number): number {
  for (let cursor = start + 1; cursor < text.length; cursor++) {
    const char = text.charAt(cursor);
    if (char === "\\") cursor++;
    else if (char === "]") return cursor;
  }
  return text.length;
}

function unwrap(written: string): string {
  return written.startsWith("<") && written.endsWith(">") ? written.slice(1, -1) : written;
}

function splitUrl(url: string): { readonly path: string; readonly fragment: string | null } {
  const hash = url.indexOf("#");
  const beforeHash = hash === -1 ? url : url.slice(0, hash);
  const query = beforeHash.indexOf("?");
  return {
    path: query === -1 ? beforeHash : beforeHash.slice(0, query),
    fragment: hash === -1 ? null : url.slice(hash + 1),
  };
}

/** Resolves links of one source; `page` is the route of the page a source offset lands on. */
class Resolver {
  private readonly readmeEntries = new Map<string, ReadmeEntry>();
  private readonly fileEntries = new Map<string, FileEntry>();

  constructor(
    private readonly targets: LinkTargets,
    private readonly source: string,
  ) {
    for (const entry of targets.pageMap.readme) {
      for (const name of isReadmePage(entry) ? entry.sections : entry.omit) {
        this.readmeEntries.set(name, entry);
      }
    }
    for (const entry of targets.pageMap.files) {
      this.fileEntries.set(isFilePage(entry) ? entry.source : entry.omit, entry);
    }
  }

  /** The route of the page holding `offset` of this source, if it is rendered. */
  page(offset: number): string | undefined {
    if (this.source !== README) {
      const entry = this.fileEntries.get(this.source);
      return entry !== undefined && isFilePage(entry) ? entry.route : undefined;
    }
    const section = this.targets.readmeSections.find(
      (candidate) => offset >= candidate.start && offset < candidate.end,
    );
    const entry = section === undefined ? undefined : this.readmeEntries.get(section.name);
    return entry !== undefined && isReadmePage(entry) ? entry.route : undefined;
  }

  private github(path: string, kind: "file" | "directory", fragment: string | null): string {
    const { repository } = this.targets.pageMap;
    const version = this.targets.version;
    if (kind === "directory") {
      return path === ""
        ? `${repository}/tree/v${version}`
        : `${repository}/tree/v${version}/${encodePath(path)}`;
    }
    const anchor = fragment === null ? "" : `#${fragment}`;
    return `${blobBase(this.targets.pageMap, version)}/${encodePath(path)}${anchor}`;
  }

  private readme(fragment: string | null): Resolution {
    const anchor = fragment === null || fragment === "" ? null : decode(fragment);
    let sectionName = INTRO;
    if (anchor !== null) {
      const heading = (this.targets.headings.get(README) ?? []).find(
        (candidate) => candidate.id === anchor,
      );
      if (heading === undefined) return { kind: "broken", reason: `no such anchor on ${README}` };
      sectionName =
        this.targets.readmeSections.find(
          (section) => heading.offset >= section.start && heading.offset < section.end,
        )?.name ?? INTRO;
    }
    const entry = this.readmeEntries.get(sectionName);
    if (entry === undefined || !isReadmePage(entry)) {
      return { kind: "url", url: this.github(README, "file", fragment) };
    }
    if (!isRendered(entry, this.targets.version)) return { kind: "text" };
    return { kind: "site", route: entry.route, anchor };
  }

  private file(path: string, fragment: string | null): Resolution {
    const entry = this.fileEntries.get(path);
    if (entry === undefined || !isFilePage(entry)) {
      return { kind: "url", url: this.github(path, "file", fragment) };
    }
    if (!isRendered(entry, this.targets.version)) return { kind: "text" };
    const anchor = fragment === null || fragment === "" ? null : decode(fragment);
    if (
      anchor !== null &&
      !(this.targets.headings.get(path) ?? []).some((heading) => heading.id === anchor)
    ) {
      return { kind: "broken", reason: `no such anchor on ${entry.route}` };
    }
    return { kind: "site", route: entry.route, anchor };
  }

  private target(path: string, fragment: string | null): Resolution {
    if (path === README) return this.readme(fragment);
    return this.file(path, fragment);
  }

  resolve(url: string): Resolution {
    if (isExternal(url)) return { kind: "unchanged" };
    const { path, fragment } = splitUrl(url);
    if (path === "") return this.target(this.source, fragment);
    const decoded = decode(path);
    const base = decoded.startsWith("/") ? "" : posix.dirname(this.source);
    const joined = posix.normalize(posix.join(base, decoded.replace(/^\/+/, "")));
    if (joined === ".." || joined.startsWith("../")) {
      return { kind: "broken", reason: "leaves the repository" };
    }
    const normalized = joined === "." || joined === "./" ? "" : joined.replace(/\/+$/, "");
    const kind = this.targets.repository.kind(normalized);
    if (kind === undefined) return { kind: "broken", reason: "no such file" };
    if (kind === "directory") return { kind: "url", url: this.github(normalized, kind, null) };
    return this.target(normalized, fragment);
  }
}

function within(offset: number, ranges: ReadonlyArray<Range> | undefined): boolean {
  return (
    ranges === undefined || ranges.some((range) => offset >= range.start && offset < range.end)
  );
}

/**
 * The edits rewriting every link of `text` (the source at `path`) that lies in
 * `ranges` (the whole text when omitted), the site links it produces, and a
 * finding for every broken link.
 */
export function rewriteLinks(
  path: string,
  text: string,
  targets: LinkTargets,
  ranges?: ReadonlyArray<Range>,
): LinkRewrite {
  const resolver = new Resolver(targets, path);
  const edits: Array<Edit> = [];
  const links: Array<SiteLink> = [];
  const findings: Array<MarkdownFinding> = [];
  let held = 0;
  const fail = (offset: number, line: number, written: string, reason: string): void => {
    findings.push({ offset, message: `✗ ${path}:${line}: ${written} — ${reason}` });
  };

  const root = parseMarkdown(text);
  const definitions = new Map<string, Definition>();
  const references: Array<LinkReference> = [];
  const imageReferences: Array<ImageReference> = [];
  const nodes: Array<Link | Image | Definition> = [];
  const collect = (node: Nodes): void => {
    switch (node.type) {
      case "code":
      case "inlineCode":
      case "html":
        return;
      case "definition":
        if (!definitions.has(node.identifier)) definitions.set(node.identifier, node);
        nodes.push(node);
        return;
      case "link":
      case "image":
        nodes.push(node);
        break;
      case "linkReference":
        references.push(node);
        break;
      case "imageReference":
        imageReferences.push(node);
        break;
      default:
        break;
    }
    if ("children" in node) (node.children as ReadonlyArray<Nodes>).forEach(collect);
  };
  collect(root);

  /** Replaces the destination at `range` as `resolution` says; `"text"` when the link must go. */
  const rewrite = (
    range: Range,
    offset: number,
    line: number,
    resolution: Resolution,
  ): "kept" | "text" => {
    const written = unwrap(text.slice(range.start, range.end));
    switch (resolution.kind) {
      case "unchanged":
        return "kept";
      case "broken":
        fail(offset, line, written, resolution.reason);
        return "kept";
      case "text":
        return "text";
      case "url":
        edits.push({ ...range, text: destination(resolution.url) });
        return "kept";
      case "site": {
        const fragment = splitUrl(written).fragment;
        const anchor = resolution.anchor === null || fragment === null ? "" : `#${fragment}`;
        const samePage = resolver.page(offset) === resolution.route;
        const href = samePage && anchor !== "" ? anchor : `${resolution.route}${anchor}`;
        if (href !== written) edits.push({ ...range, text: destination(href) });
        links.push({
          source: path,
          line,
          link: written,
          route: resolution.route,
          anchor: resolution.anchor,
        });
        return "kept";
      }
    }
  };

  /** Keeps a link's label as plain text: drops `[` and everything from the closing `]`. */
  const unlink = (node: Link | LinkReference, start: number, end: number): void => {
    edits.push({ start, end: start + 1, text: "" });
    edits.push({ start: labelClose(node, text), end, text: "" });
    held++;
  };

  const heldDefinitions = new Set<string>();
  for (const node of nodes) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const line = node.position?.start.line ?? 0;
    if (start === undefined || end === undefined || !within(start, ranges)) continue;
    if (node.type === "image") {
      if (!isExternal(node.url)) {
        fail(start, line, node.url, "relative images are not served");
      }
      continue;
    }
    if (node.type === "definition") {
      const range = destinationRange(text, definitionLabelClose(text, start) + 2);
      if (rewrite(range, start, line, resolver.resolve(node.url)) === "text") {
        heldDefinitions.add(node.identifier);
        edits.push({ start, end, text: "" });
      }
      continue;
    }
    const close = labelClose(node, text);
    if (text.charAt(close) !== "]" || text.charAt(close + 1) !== "(") continue;
    const range = destinationRange(text, close + 2);
    if (rewrite(range, start, line, resolver.resolve(node.url)) === "text") {
      unlink(node, start, end);
    }
  }
  for (const node of references) {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined || !within(start, ranges)) continue;
    if (heldDefinitions.has(node.identifier)) unlink(node, start, end);
  }
  for (const node of imageReferences) {
    const start = node.position?.start.offset;
    const line = node.position?.start.line ?? 0;
    const definition = definitions.get(node.identifier);
    if (start === undefined || definition === undefined || !within(start, ranges)) continue;
    if (!isExternal(definition.url)) {
      fail(start, line, definition.url, "relative images are not served");
    }
  }

  edits.sort((left, right) => left.start - right.start || left.end - right.end);
  return { edits, links, findings, held };
}
