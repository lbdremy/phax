// Generates the Rspress sources under site/generated/ from the repository's
// docs and the page map: one Markdown page per rendered route, site.json
// holding what the Rspress config and the post-build checks need, and
// links.json listing every link rewritten to a site route, plus the served
// JSON Schemas, their index and _headers in Rspress's public folder beside
// site/public's logos, and theme.css rendered from site/theme/tokens.ts. The
// pure core maps paths to content; the wrappers only read site/public and
// replace the directory. Output is deterministic: sorted, `\n` line endings, no clock.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { slug } from "github-slugger";
import {
  checkPageMap,
  isFilePage,
  isReadmePage,
  isRendered,
  siteNavigation,
  type FilePage,
  type NavLink,
  type PageMap,
  type ReadmePage,
  type SidebarGroup,
  type SocialLink,
} from "./pageMap.js";
import {
  blobBase,
  repositoryOf,
  rewriteLinks,
  type LinkRewrite,
  type LinkTargets,
  type RepositoryIndex,
  type SiteLink,
} from "./links.js";
import { applyEdits, transformMarkdown, type MarkdownTransform } from "./markdown.js";
import { README, splitReadme, type ReadmeSection } from "./sources.js";
import { publicSchemas, servedUrl, type SchemaSources } from "./schemas.js";
import { themeCss } from "../theme/tokens.js";

export interface GenerateInput {
  /** Every source, keyed by repository-relative path; README.md included. */
  readonly files: ReadonlyMap<string, string>;
  readonly pageMap: PageMap;
  /** The root package.json version the site is built from. */
  readonly version: string;
  /** What relative links may name; the sources alone when omitted. */
  readonly repository?: RepositoryIndex;
  /** The release ledger and the schema snapshots; nothing is served when omitted. */
  readonly schemas?: SchemaSources;
  /** site/public's files by URL path (`/logo.svg`) → bytes, copied verbatim; none when omitted. */
  readonly assets?: ReadonlyMap<string, Uint8Array>;
}

/** site/generated/site.json: read by site/rspress.config.ts and site/build/postbuild.ts. */
export interface SiteJson {
  readonly version: string;
  readonly releaseUrl: string;
  readonly nav: ReadonlyArray<NavLink>;
  readonly sidebar: Readonly<Record<string, ReadonlyArray<SidebarGroup>>>;
  readonly socialLinks: ReadonlyArray<SocialLink>;
  /** Every rendered route, sorted. */
  readonly routes: ReadonlyArray<string>;
  /** Per rendered route, the GitHub heading ids its page carries, in page order. */
  readonly headingIds: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface SiteSummary {
  readonly version: string;
  readonly pages: number;
  readonly sources: number;
  readonly readmeSections: number;
  readonly omitted: number;
  readonly held: number;
  readonly links: {
    /** `<repository>/blob/v<version>`, where links to unrendered files point. */
    readonly blobBase: string;
    /** Links to a held source, replaced by their text. */
    readonly held: number;
    readonly broken: number;
  };
  /** The served JSON Schemas, or null when the build was given no schema sources. */
  readonly schemas: {
    readonly served: number;
    readonly releases: number;
    readonly formats: number;
  } | null;
}

export interface GeneratedSite {
  /** Paths relative to site/generated/ → content. Empty when there are findings. */
  readonly files: ReadonlyMap<string, string>;
  /**
   * Files Rspress copies verbatim, by URL path (`/schemas/…`, `/_headers`,
   * `/logo.svg`) → bytes. Written under PUBLIC_DIR. Empty when there are findings.
   */
  readonly publicFiles: ReadonlyMap<string, Uint8Array>;
  readonly findings: ReadonlyArray<string>;
  readonly summary: SiteSummary;
}

/** Rspress's public folder, relative to site/generated/: `<root>/public`. */
export const PUBLIC_DIR = "docs/public";

/** The theme stylesheet, relative to site/generated/: the config's globalStyles. */
export const THEME_CSS = "theme.css";

export const SERVED_SCHEMAS_HEADING = "Served JSON Schemas";

/** The generated Markdown file of a route, relative to site/generated/. */
export function pagePath(route: string): string {
  return route === "/" ? "docs/index.md" : `docs${route}.md`;
}

function frontmatter(title: string | undefined): string {
  return title === undefined ? "" : `---\ntitle: ${JSON.stringify(title)}\n---\n\n`;
}

interface RenderedPage {
  readonly route: string;
  readonly content: string;
  readonly headingIds: ReadonlyArray<string>;
}

function within(offset: number, sections: ReadonlyArray<ReadmeSection>): boolean {
  return sections.some((section) => offset >= section.start && offset < section.end);
}

function readmePage(
  page: ReadmePage,
  readme: string,
  sections: ReadonlyMap<string, ReadmeSection>,
  transform: MarkdownTransform,
  findings: Array<string>,
): RenderedPage {
  const parts = page.sections.flatMap((name) => {
    const section = sections.get(name);
    return section === undefined ? [] : [section];
  });
  const headings = transform.headings.filter((heading) => within(heading.offset, parts));
  const ordered = parts.flatMap((part) =>
    headings.filter((heading) => heading.offset >= part.start && heading.offset < part.end),
  );
  // Without a `#` heading, Rspress renders the title as the page's heading,
  // whose id must not take a section's anchor.
  if (!ordered.some((heading) => heading.depth === 1)) {
    const titleId = slug(page.title);
    if (ordered.some((heading) => heading.id === titleId)) {
      findings.push(
        `✗ page map: ${page.route} has title "${page.title}", whose heading id #${titleId} a section already uses`,
      );
    }
  }
  const body = parts
    .map((part) => applyEdits(readme, transform.edits, part.start, part.end).trimEnd())
    .join("\n\n");
  return {
    route: page.route,
    content: `${frontmatter(page.title)}${body}\n`,
    headingIds: ordered.map((heading) => heading.id),
  };
}

function filePage(page: FilePage, text: string, transform: MarkdownTransform): RenderedPage {
  return {
    route: page.route,
    content: `${frontmatter(page.title)}${applyEdits(text, transform.edits).trimEnd()}\n`,
    headingIds: transform.headings.map((heading) => heading.id),
  };
}

/** `transform` with the link rewrites' edits merged in, in offset order. */
function withLinks(transform: MarkdownTransform, links: LinkRewrite): MarkdownTransform {
  return {
    ...transform,
    edits: [...transform.edits, ...links.edits].toSorted(
      (left, right) => left.start - right.start || left.end - right.end,
    ),
  };
}

export function linksLine(summary: SiteSummary): string {
  const { links } = summary;
  return (
    `site: links — rewritten to routes and to ${links.blobBase.replace(/^https?:\/\//, "")}, ` +
    `${links.held} held, ${links.broken} broken`
  );
}

/** The schemas line, or undefined when the build serves no schema. */
export function schemasLine(summary: SiteSummary): string | undefined {
  const { schemas } = summary;
  if (schemas === null) return undefined;
  return (
    `site: schemas — ${schemas.served} served ` +
    `(ledger: ${schemas.releases} × ${schemas.formats} formats), ledger ends at or below package.json`
  );
}

/** The appended section listing every served schema URL, under its explicit heading id. */
function servedSchemasSection(id: string, paths: ReadonlyArray<string>): string {
  return [
    `## ${SERVED_SCHEMAS_HEADING} \\{#${id}\\}`,
    "",
    "Every `$schema` URL a released phax writes is served here, byte for byte:",
    "",
    ...paths.map((path) => `- \`${servedUrl(path)}\``),
    "",
  ].join("\n");
}

/**
 * `page` with the served-schemas section appended. Its heading id must
 * collide with no README heading id, so that every README anchor keeps
 * meaning what it means on GitHub.
 */
function withServedSchemas(
  page: RenderedPage,
  served: ReadonlyArray<string> | undefined,
  readmeIds: ReadonlyArray<string>,
  findings: Array<string>,
): RenderedPage {
  if (served === undefined) {
    findings.push(`✗ page map: ${page.route} lists the served schemas, but the build has none`);
    return page;
  }
  const id = slug(SERVED_SCHEMAS_HEADING);
  if (readmeIds.includes(id)) {
    findings.push(
      `✗ ${page.route}: the "${SERVED_SCHEMAS_HEADING}" heading id #${id} is already a README heading id`,
    );
  }
  return {
    ...page,
    content: `${page.content}\n${servedSchemasSection(id, served)}`,
    headingIds: [...page.headingIds, id],
  };
}

export function summaryLine(summary: SiteSummary): string {
  return (
    `site: v${summary.version} — ${summary.pages} pages from ${summary.sources} sources ` +
    `(README: ${summary.readmeSections} sections, ${summary.omitted} omitted, ${summary.held} held)`
  );
}

/** The site's generated files for `input`, or every finding that prevents them. */
export function generateSite(input: GenerateInput): GeneratedSite {
  const { files, pageMap, version } = input;
  const readme = files.get(README) ?? "";
  const readmeSections = splitReadme(readme);
  const sectionsByName = new Map(readmeSections.map((section) => [section.name, section]));
  const readmePages = pageMap.readme.filter(isReadmePage);
  const filePages = pageMap.files.filter(isFilePage);

  const summary: SiteSummary = {
    version,
    pages: 0,
    sources: 0,
    readmeSections: readmeSections.length - 1,
    omitted: pageMap.readme.reduce(
      (count, entry) => count + (isReadmePage(entry) ? 0 : entry.omit.length),
      0,
    ),
    held: readmePages
      .filter((page) => !isRendered(page, version))
      .reduce((count, page) => count + page.sections.length, 0),
    links: { blobBase: blobBase(pageMap, version), held: 0, broken: 0 },
    schemas: null,
  };

  const mapFindings = checkPageMap(pageMap, {
    readmeSections: readmeSections.map((section) => section.name),
    files: [...files.keys()].filter((path) => path !== README).toSorted(),
  });
  if (mapFindings.length > 0) {
    return { files: new Map(), publicFiles: new Map(), findings: mapFindings, summary };
  }

  const findings: Array<string> = [];
  const schemas = input.schemas === undefined ? undefined : publicSchemas(input.schemas, version);
  if (schemas !== undefined) findings.push(...schemas.findings);
  const publicFiles = new Map(schemas?.files ?? []);
  for (const [path, bytes] of input.assets ?? []) {
    if (publicFiles.has(path))
      findings.push(`✗ site/public${path}: the build already serves ${path}`);
    publicFiles.set(path, bytes);
  }
  const rendered: Array<RenderedPage> = [];
  const siteLinks: Array<SiteLink> = [];
  let heldLinks = 0;
  let brokenLinks = 0;
  const addLinks = (rewrite: LinkRewrite): void => {
    findings.push(...rewrite.findings.map((finding) => finding.message));
    siteLinks.push(...rewrite.links);
    heldLinks += rewrite.held;
    brokenLinks += rewrite.findings.length;
  };

  // Every rendered source is transformed first: a link's anchor is checked
  // against its target's GitHub heading ids. README.md's ids are always
  // known, so that a link into an omitted section still resolves.
  const readmeTransform = transformMarkdown(README, readme);
  const renderedFiles = filePages.filter((page) => isRendered(page, version));
  const fileTransforms = new Map(
    renderedFiles.map((page) => [
      page.source,
      transformMarkdown(page.source, files.get(page.source) ?? ""),
    ]),
  );
  const targets: LinkTargets = {
    pageMap,
    version,
    repository: input.repository ?? repositoryOf(files.keys()),
    headings: new Map([
      [README, readmeTransform.headings],
      ...[...fileTransforms].map(([path, transform]) => [path, transform.headings] as const),
    ]),
    readmeSections,
  };

  const renderedReadme = readmePages.filter((page) => isRendered(page, version));
  if (renderedReadme.length > 0) {
    const renderedSections = renderedReadme.flatMap((page) =>
      page.sections.flatMap((name) => {
        const section = sectionsByName.get(name);
        return section === undefined ? [] : [section];
      }),
    );
    for (const finding of readmeTransform.findings) {
      if (within(finding.offset, renderedSections)) findings.push(finding.message);
    }
    const links = rewriteLinks(README, readme, targets, renderedSections);
    addLinks(links);
    const transform = withLinks(readmeTransform, links);
    const readmeIds = readmeTransform.headings.map((heading) => heading.id);
    for (const page of renderedReadme) {
      const content = readmePage(page, readme, sectionsByName, transform, findings);
      rendered.push(
        page.generated === "served-schemas"
          ? withServedSchemas(content, schemas?.served, readmeIds, findings)
          : content,
      );
    }
  }
  for (const page of renderedFiles) {
    const text = files.get(page.source) ?? "";
    const transform = fileTransforms.get(page.source) ?? transformMarkdown(page.source, text);
    findings.push(...transform.findings.map((finding) => finding.message));
    const links = rewriteLinks(page.source, text, targets);
    addLinks(links);
    rendered.push(filePage(page, text, withLinks(transform, links)));
  }

  const counted: SiteSummary = {
    ...summary,
    pages: rendered.length,
    sources:
      (renderedReadme.length > 0 ? 1 : 0) + new Set(renderedFiles.map((page) => page.source)).size,
    links: { ...summary.links, held: heldLinks, broken: brokenLinks },
    schemas:
      schemas === undefined
        ? null
        : { served: schemas.served.length, releases: schemas.releases, formats: schemas.formats },
  };
  if (findings.length > 0) {
    return { files: new Map(), publicFiles: new Map(), findings, summary: counted };
  }

  rendered.sort((left, right) =>
    left.route < right.route ? -1 : left.route > right.route ? 1 : 0,
  );
  const navigation = siteNavigation(pageMap, version);
  const site: SiteJson = {
    version,
    releaseUrl: navigation.releaseUrl,
    nav: navigation.nav,
    sidebar: navigation.sidebar,
    socialLinks: navigation.socialLinks,
    routes: rendered.map((page) => page.route),
    headingIds: Object.fromEntries(rendered.map((page) => [page.route, page.headingIds])),
  };
  const output = new Map<string, string>(
    rendered.map((page) => [pagePath(page.route), page.content]),
  );
  output.set("site.json", `${JSON.stringify(site, null, 2)}\n`);
  output.set("links.json", `${JSON.stringify(siteLinks, null, 2)}\n`);
  output.set(THEME_CSS, themeCss());
  return {
    files: new Map([...output].toSorted(([left], [right]) => (left < right ? -1 : 1))),
    publicFiles: new Map([...publicFiles].toSorted(([left], [right]) => (left < right ? -1 : 1))),
    findings: [],
    summary: counted,
  };
}

/** Every file under `directory` (site/public), by URL path → bytes; none when it is missing. */
export function readPublicAssets(directory: string): ReadonlyMap<string, Uint8Array> {
  const assets = new Map<string, Uint8Array>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) {
        assets.set(`/${relative(directory, path).split("\\").join("/")}`, readFileSync(path));
      }
    }
  };
  if (existsSync(directory)) walk(directory);
  return new Map([...assets].toSorted(([left], [right]) => (left < right ? -1 : 1)));
}

/** Replaces `directory` with exactly `files`, and `publicFiles` under PUBLIC_DIR. */
export function writeGeneratedSite(
  directory: string,
  files: ReadonlyMap<string, string>,
  publicFiles: ReadonlyMap<string, Uint8Array> = new Map(),
): void {
  rmSync(directory, { recursive: true, force: true });
  const outputs: ReadonlyArray<readonly [string, string | Uint8Array]> = [
    ...files,
    ...[...publicFiles].map(([path, bytes]) => [`${PUBLIC_DIR}${path}`, bytes] as const),
  ];
  for (const [path, content] of outputs) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
