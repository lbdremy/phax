// Checks over the built site: every rendered route has its page, every page
// shows the release it was built from, every GitHub heading id the generator
// emitted reached the HTML, every anchor a link was rewritten to is an id on
// its target page, and no HTML, CSS or JS file loads anything from another
// origin. Outbound `<a href>` links are fine. Every page's favicon is the
// logo and its nav shows the lowercase wordmark. Every served JSON Schema, the
// schema index, _headers and the logos are in the output byte for byte. Pure
// over maps of built files; readBuiltSite and readBuiltPublic are the only I/O.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { SiteJson } from "./generate.js";
import type { SiteLink } from "./links.js";

/** The built files a check reads, relative to the output directory → text. */
export type BuiltFiles = ReadonlyMap<string, string>;

const CHECKED_EXTENSIONS = new Set([".html", ".css", ".js", ".mjs"]);

/** Every HTML, CSS and JS file under `directory`, keyed by `/`-separated relative path. */
export function readBuiltSite(directory: string): BuiltFiles {
  const files = new Map<string, string>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile() && CHECKED_EXTENSIONS.has(extname(entry.name))) {
        files.set(relative(directory, path).split("\\").join("/"), readFileSync(path, "utf8"));
      }
    }
  };
  walk(directory);
  return new Map([...files].toSorted(([left], [right]) => (left < right ? -1 : 1)));
}

/** The built HTML files a route may be served from, preferred first. */
export function routeHtmlPaths(route: string): ReadonlyArray<string> {
  if (route === "/") return ["index.html"];
  const path = route.slice(1);
  return [`${path}.html`, `${path}/index.html`];
}

const REMOTE = /^\s*(?:https?:)?\/\//i;
const TAG = /<([a-zA-Z][a-zA-Z0-9-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
const ATTRIBUTE = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const LOADING_RELS = new Set(["stylesheet", "preload", "modulepreload", "icon", "manifest"]);
const CSS_URL = /url\(\s*(["']?)([^"')]*)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(["'])([^"']*)\1/gi;
const JS_IMPORT = /\bimport\s*\(\s*(["'`])((?:https?:)?\/\/[^"'`]*)\1/g;
const JS_FROM = /\b(?:from|import)\s*(["'])(https?:\/\/[^"']*)\1/g;

function attributes(source: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = match[1]?.toLowerCase();
    if (name !== undefined) result.set(name, match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function srcsetUrls(srcset: string): ReadonlyArray<string> {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0] ?? "")
    .filter((url) => url !== "");
}

function cssRemoteLoads(css: string): ReadonlyArray<string> {
  const urls = [
    ...[...css.matchAll(CSS_URL)].map((match) => match[2] ?? ""),
    ...[...css.matchAll(CSS_IMPORT)].map((match) => match[2] ?? ""),
  ];
  return urls.filter((url) => REMOTE.test(url)).map((url) => `${url.trim()} (CSS url()/@import)`);
}

function jsRemoteLoads(js: string): ReadonlyArray<string> {
  return [
    ...[...js.matchAll(JS_IMPORT)].map((match) => `${match[2] ?? ""} (JS import())`),
    ...[...js.matchAll(JS_FROM)].map((match) => `${match[2] ?? ""} (JS import)`),
  ];
}

function htmlRemoteLoads(html: string): ReadonlyArray<string> {
  const loads: Array<string> = [];
  for (const match of html.matchAll(TAG)) {
    const tag = (match[1] ?? "").toLowerCase();
    const attrs = attributes(match[2] ?? "");
    const remote = (name: string, form: string): void => {
      const value = attrs.get(name);
      if (value !== undefined && REMOTE.test(value)) loads.push(`${value.trim()} (${form})`);
    };
    if (tag === "script") remote("src", "script src");
    if (tag === "link") {
      const rels = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
      if (rels.some((rel) => LOADING_RELS.has(rel))) remote("href", `link rel=${attrs.get("rel")}`);
    }
    if (tag === "img" || tag === "source") {
      remote("src", `${tag} src`);
      for (const url of srcsetUrls(attrs.get("srcset") ?? "")) {
        if (REMOTE.test(url)) loads.push(`${url} (${tag} srcset)`);
      }
    }
    const style = attrs.get("style");
    if (style !== undefined) loads.push(...cssRemoteLoads(style));
  }
  for (const match of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    loads.push(...cssRemoteLoads(match[1] ?? ""));
  }
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    loads.push(...jsRemoteLoads(match[1] ?? ""));
  }
  return loads;
}

/** Every resource `path` loads from an absolute http(s) or protocol-relative URL. */
export function remoteLoads(path: string, content: string): ReadonlyArray<string> {
  switch (extname(path)) {
    case ".html":
      return htmlRemoteLoads(content);
    case ".css":
      return cssRemoteLoads(content);
    case ".js":
    case ".mjs":
      return jsRemoteLoads(content);
    default:
      return [];
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasId(html: string, id: string): boolean {
  return new RegExp(`\\sid=["']${escapeRegExp(id)}["']`).test(html);
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** The favicon every page links to: the dark-accent logo. */
export const FAVICON = "/logo.svg";

/** The nav wordmark, lowercase. */
export const WORDMARK = "phax";

/** The href of every `<link rel="icon">` in `html`. */
export function iconHrefs(html: string): ReadonlyArray<string> {
  const hrefs: Array<string> = [];
  for (const match of html.matchAll(TAG)) {
    if ((match[1] ?? "").toLowerCase() !== "link") continue;
    const attrs = attributes(match[2] ?? "");
    const rels = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/);
    if (rels.includes("icon")) hrefs.push(attrs.get("href") ?? "");
  }
  return hrefs;
}

/** The text of the nav title link (Rspress's `rp-nav__title__link`), or undefined without one. */
export function navTitle(html: string): string | undefined {
  const match =
    /<a\b[^>]*\bclass=["'][^"']*\brp-nav__title__link\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/.exec(html);
  return match === null ? undefined : stripTags(match[1] ?? "").trim();
}

/** True when `html` holds a link to `releaseUrl` whose text shows `v<version>`. */
export function showsRelease(html: string, releaseUrl: string, version: string): boolean {
  const anchor = new RegExp(
    `<a\\b[^>]*\\bhref=["']${escapeRegExp(releaseUrl)}["'][^>]*>([\\s\\S]*?)</a>`,
    "g",
  );
  return [...html.matchAll(anchor)].some((match) =>
    stripTags(match[1] ?? "").includes(`v${version}`),
  );
}

/** Every finding about the built files against site.json, as `✗ …` lines. */
export function checkBuiltSite(
  site: SiteJson,
  built: BuiltFiles,
  outLabel = "site/doc_build",
): ReadonlyArray<string> {
  const findings: Array<string> = [];
  for (const route of site.routes) {
    const candidates = routeHtmlPaths(route);
    const path = candidates.find((candidate) => built.has(candidate));
    const html = path === undefined ? undefined : built.get(path);
    if (path === undefined || html === undefined) {
      findings.push(`✗ ${outLabel}: route ${route} has no page (${candidates.join(" or ")})`);
      continue;
    }
    if (!showsRelease(html, site.releaseUrl, site.version)) {
      findings.push(
        `✗ ${outLabel}/${path}: does not show v${site.version} linking to ${site.releaseUrl}`,
      );
    }
    const icons = iconHrefs(html);
    if (icons.length === 0 || icons.some((href) => href !== FAVICON)) {
      findings.push(
        `✗ ${outLabel}/${path}: favicon is ${icons.length === 0 ? "missing" : icons.join(", ")}, not ${FAVICON}`,
      );
    }
    const title = navTitle(html);
    if (title !== WORDMARK) {
      findings.push(
        `✗ ${outLabel}/${path}: nav shows ${title === undefined ? "no wordmark" : `"${title}"`}, not the wordmark "${WORDMARK}"`,
      );
    }
    for (const id of site.headingIds[route] ?? []) {
      if (!hasId(html, id)) {
        findings.push(`✗ ${outLabel}/${path}: heading id #${id} of route ${route} is missing`);
      }
    }
  }
  for (const [path, content] of built) {
    for (const load of remoteLoads(path, content)) {
      findings.push(`✗ ${outLabel}/${path}: loads ${load} from another origin`);
    }
  }
  return findings;
}

/**
 * Every file under `schemas/` in `directory` and each of `paths` (`/_headers`,
 * `/logo.svg`, …) that exists, by URL path → bytes.
 */
export function readBuiltPublic(
  directory: string,
  paths: Iterable<string> = ["/_headers"],
): ReadonlyMap<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  for (const path of paths) {
    const file = join(directory, path);
    if (existsSync(file)) files.set(path, readFileSync(file));
  }
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        files.set(`/${relative(directory, path).split("\\").join("/")}`, readFileSync(path));
      }
    }
  };
  if (existsSync(join(directory, "schemas"))) walk(join(directory, "schemas"));
  return new Map([...files].toSorted(([left], [right]) => (left < right ? -1 : 1)));
}

const UNSERVED_SNAPSHOT = /(?:^|\/)(?:pre-schema|next)(?:[./]|$)/;

/**
 * Every finding about the public files (the served schemas, `_headers`,
 * `/schemas/index.json`, the logos) in the build: each expected file must be
 * in the output byte for byte, and no
 * file under schemas/ may name a pre-schema or next snapshot.
 */
export function checkServedSchemas(
  expected: ReadonlyMap<string, Uint8Array>,
  built: ReadonlyMap<string, Uint8Array>,
  outLabel = "site/doc_build",
): ReadonlyArray<string> {
  const findings: Array<string> = [];
  for (const [path, bytes] of expected) {
    const actual = built.get(path);
    if (actual === undefined) findings.push(`✗ ${outLabel}${path}: missing`);
    else if (!Buffer.from(actual).equals(Buffer.from(bytes))) {
      findings.push(`✗ ${outLabel}${path}: differs from what the build served`);
    }
  }
  for (const path of built.keys()) {
    if (path.startsWith("/schemas/") && UNSERVED_SNAPSHOT.test(path.slice("/schemas/".length))) {
      findings.push(`✗ ${outLabel}${path}: names a snapshot that is never served`);
    }
  }
  return findings;
}

/** Every rewritten link (site/generated/links.json) whose anchor its route's built page lacks. */
export function checkLinkAnchors(
  links: ReadonlyArray<SiteLink>,
  built: BuiltFiles,
): ReadonlyArray<string> {
  const findings: Array<string> = [];
  for (const link of links) {
    if (link.anchor === null) continue;
    const html = routeHtmlPaths(link.route)
      .map((candidate) => built.get(candidate))
      .find((content) => content !== undefined);
    if (html === undefined || !hasId(html, link.anchor)) {
      findings.push(
        `✗ ${link.source}:${link.line}: ${link.link} — no such anchor on ${link.route}`,
      );
    }
  }
  return findings;
}
