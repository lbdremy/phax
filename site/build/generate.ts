// Generates the Rspress sources under site/generated/ from the repository's
// docs and the page map: one Markdown page per rendered route, and site.json
// holding what the Rspress config and the post-build checks need. The pure
// core maps paths to content; the wrapper only removes and rewrites the
// directory. Output is deterministic: sorted, `\n` line endings, no clock.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
import { applyEdits, transformMarkdown, type MarkdownTransform } from "./markdown.js";
import { README, splitReadme, type ReadmeSection } from "./sources.js";

export interface GenerateInput {
  /** Every source, keyed by repository-relative path; README.md included. */
  readonly files: ReadonlyMap<string, string>;
  readonly pageMap: PageMap;
  /** The root package.json version the site is built from. */
  readonly version: string;
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
}

export interface GeneratedSite {
  /** Paths relative to site/generated/ → content. Empty when there are findings. */
  readonly files: ReadonlyMap<string, string>;
  readonly findings: ReadonlyArray<string>;
  readonly summary: SiteSummary;
}

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
  };

  const mapFindings = checkPageMap(pageMap, {
    readmeSections: readmeSections.map((section) => section.name),
    files: [...files.keys()].filter((path) => path !== README).toSorted(),
  });
  if (mapFindings.length > 0) return { files: new Map(), findings: mapFindings, summary };

  const findings: Array<string> = [];
  const rendered: Array<RenderedPage> = [];
  const renderedReadme = readmePages.filter((page) => isRendered(page, version));
  if (renderedReadme.length > 0) {
    const transform = transformMarkdown(README, readme);
    const renderedSections = renderedReadme.flatMap((page) =>
      page.sections.flatMap((name) => {
        const section = sectionsByName.get(name);
        return section === undefined ? [] : [section];
      }),
    );
    for (const finding of transform.findings) {
      if (within(finding.offset, renderedSections)) findings.push(finding.message);
    }
    for (const page of renderedReadme) {
      rendered.push(readmePage(page, readme, sectionsByName, transform, findings));
    }
  }
  const renderedFiles = filePages.filter((page) => isRendered(page, version));
  for (const page of renderedFiles) {
    const text = files.get(page.source) ?? "";
    const transform = transformMarkdown(page.source, text);
    findings.push(...transform.findings.map((finding) => finding.message));
    rendered.push(filePage(page, text, transform));
  }

  const counted: SiteSummary = {
    ...summary,
    pages: rendered.length,
    sources:
      (renderedReadme.length > 0 ? 1 : 0) + new Set(renderedFiles.map((page) => page.source)).size,
  };
  if (findings.length > 0) return { files: new Map(), findings, summary: counted };

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
  return {
    files: new Map([...output].toSorted(([left], [right]) => (left < right ? -1 : 1))),
    findings: [],
    summary: counted,
  };
}

/** Replaces `directory` with exactly `files`. */
export function writeGeneratedSite(directory: string, files: ReadonlyMap<string, string>): void {
  rmSync(directory, { recursive: true, force: true });
  for (const [path, content] of files) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
