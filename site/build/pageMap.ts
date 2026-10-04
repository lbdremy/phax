// The docs site's page map: which route renders which README section or
// docs file, what is deliberately left out, and what is held until a
// release. `site/pages.ts` is the only instance; the generator refuses a map
// that leaves a source unassigned or names one that no longer exists.
import { compareReleases, isRelease } from "../../src/schemas/schemaUrl.js";

/** The README text before its first `##` heading. */
export const INTRO = "(intro)";

export interface ReadmePage {
  readonly route: string;
  readonly title: string;
  /** README `##` section names (heading plain text), in page order. */
  readonly sections: ReadonlyArray<string>;
  /** X.Y.Z: the page is rendered only by builds at or after this release. */
  readonly holdUntil?: string;
  /** A section the generator appends after `sections`: `served-schemas` lists every served schema URL. */
  readonly generated?: "served-schemas";
}

export interface ReadmeOmission {
  readonly omit: ReadonlyArray<string>;
  readonly why: string;
}

export interface FilePage {
  readonly route: string;
  readonly title?: string;
  /** Repository-relative path of the rendered file. */
  readonly source: string;
  readonly holdUntil?: string;
}

export interface FileOmission {
  readonly omit: string;
  readonly why: string;
}

export type ReadmeEntry = ReadmePage | ReadmeOmission;
export type FileEntry = FilePage | FileOmission;

export interface PageMap {
  readonly repository: string;
  readonly readme: ReadonlyArray<ReadmeEntry>;
  readonly files: ReadonlyArray<FileEntry>;
}

export function definePageMap(map: PageMap): PageMap {
  return map;
}

export function isReadmePage(entry: ReadmeEntry): entry is ReadmePage {
  return "route" in entry;
}

export function isFilePage(entry: FileEntry): entry is FilePage {
  return "route" in entry;
}

/** True when a build at `version` renders an entry held until `holdUntil`. */
export function isRendered(entry: { readonly holdUntil?: string }, version: string): boolean {
  return entry.holdUntil === undefined || compareReleases(version, entry.holdUntil) >= 0;
}

export function sectionLabel(name: string): string {
  return name === INTRO ? INTRO : `## ${name}`;
}

/** What the map is checked against: README section names and the other source paths. */
export interface SourceInventory {
  readonly readmeSections: ReadonlyArray<string>;
  readonly files: ReadonlyArray<string>;
}

const ROUTE = /^\/(?:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*)?$/;
const VERSION_SEGMENT = /^v?\d/;

function countBy(values: ReadonlyArray<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

/** Every finding about `map` against `sources`, as `✗ …` lines; empty when the map is sound. */
export function checkPageMap(map: PageMap, sources: SourceInventory): ReadonlyArray<string> {
  const findings: Array<string> = [];

  const mappedSections = map.readme.flatMap((entry) =>
    isReadmePage(entry) ? entry.sections : entry.omit,
  );
  const sectionCounts = countBy(mappedSections);
  for (const name of sources.readmeSections) {
    if (!sectionCounts.has(name)) {
      findings.push(`✗ README.md: section "${sectionLabel(name)}" is not in the page map`);
    }
  }
  const readmeSections = new Set(sources.readmeSections);
  for (const [name, count] of sectionCounts) {
    if (!readmeSections.has(name)) {
      findings.push(
        `✗ page map: names README section "${sectionLabel(name)}", which README.md no longer has`,
      );
    }
    if (count > 1) {
      findings.push(
        `✗ page map: README section "${sectionLabel(name)}" is assigned ${count} times`,
      );
    }
  }

  const mappedFiles = map.files.map((entry) => (isFilePage(entry) ? entry.source : entry.omit));
  const fileCounts = countBy(mappedFiles);
  for (const path of sources.files) {
    if (!fileCounts.has(path)) findings.push(`✗ ${path}: source file is not in the page map`);
  }
  const files = new Set(sources.files);
  for (const [path, count] of fileCounts) {
    if (!files.has(path)) findings.push(`✗ page map: names ${path}, which does not exist`);
    if (count > 1) findings.push(`✗ page map: ${path} is assigned ${count} times`);
  }

  const pages = [...map.readme.filter(isReadmePage), ...map.files.filter(isFilePage)];
  for (const [route, count] of countBy(pages.map((page) => page.route))) {
    if (count > 1) findings.push(`✗ page map: route ${route} is used ${count} times`);
  }
  for (const page of pages) {
    if (!ROUTE.test(page.route)) {
      findings.push(
        `✗ page map: route "${page.route}" is not a lowercase path starting with / and not ending with /`,
      );
    }
    const first = page.route.split("/")[1] ?? "";
    if (VERSION_SEGMENT.test(first)) {
      findings.push(`✗ page map: route ${page.route} starts with a version segment`);
    }
    if (page.holdUntil !== undefined && !isRelease(page.holdUntil)) {
      findings.push(
        `✗ page map: ${page.route} holds until "${page.holdUntil}", which is not X.Y.Z`,
      );
    }
  }
  return findings;
}

export interface NavLink {
  readonly text: string;
  readonly link: string;
  readonly activeMatch?: string;
}

export interface SidebarLink {
  readonly text: string;
  readonly link: string;
}

export interface SidebarGroup {
  readonly text: string;
  readonly items: ReadonlyArray<SidebarLink>;
}

export interface SocialLink {
  readonly icon: "github";
  readonly mode: "link";
  readonly content: string;
}

export interface SiteNavigation {
  readonly releaseUrl: string;
  readonly nav: ReadonlyArray<NavLink>;
  /** Rspress sidebar: one set of groups shared by every route. */
  readonly sidebar: Readonly<Record<string, ReadonlyArray<SidebarGroup>>>;
  readonly socialLinks: ReadonlyArray<SocialLink>;
}

/** Sidebar groups by a route's first segment, in display order; `/` joins the guide. */
const GROUPS: ReadonlyArray<{
  readonly segment: string;
  readonly text: string;
  readonly nav: boolean;
}> = [
  { segment: "guide", text: "Guide", nav: true },
  { segment: "reference", text: "Reference", nav: true },
  { segment: "security", text: "Security", nav: true },
  { segment: "compare", text: "Compare", nav: true },
  { segment: "blog", text: "Blog", nav: true },
  { segment: "contributing", text: "Contributing", nav: false },
];

function groupSegment(route: string): string {
  const first = route.split("/")[1] ?? "";
  return first === "" ? "guide" : first;
}

function titleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1).replaceAll("-", " ");
}

export function releaseUrl(map: PageMap, version: string): string {
  return `${map.repository}/releases/tag/v${version}`;
}

/** The nav, sidebar and social links of a build at `version`; held entries appear nowhere. */
export function siteNavigation(map: PageMap, version: string): SiteNavigation {
  const pages = [...map.readme.filter(isReadmePage), ...map.files.filter(isFilePage)].filter(
    (page) => isRendered(page, version),
  );
  const segments = [
    ...GROUPS.map((group) => group.segment),
    ...[...new Set(pages.map((page) => groupSegment(page.route)))]
      .filter((segment) => !GROUPS.some((group) => group.segment === segment))
      .toSorted(),
  ];

  const nav: Array<NavLink> = [];
  const groups: Array<SidebarGroup> = [];
  for (const segment of segments) {
    const members = pages.filter((page) => groupSegment(page.route) === segment);
    const first = members[0];
    if (first === undefined) continue;
    const known = GROUPS.find((group) => group.segment === segment);
    const text = known?.text ?? titleCase(segment);
    groups.push({
      text,
      items: members.map((page) => ({
        text: page.title ?? titleCase(page.route.split("/").at(-1) ?? ""),
        link: page.route,
      })),
    });
    if (known?.nav !== true) continue;
    const navTarget = members.find((page) => page.route !== "/") ?? first;
    nav.push(
      navTarget.route === `/${segment}`
        ? { text, link: navTarget.route }
        : { text, link: navTarget.route, activeMatch: `^/${segment}/` },
    );
  }

  const release = releaseUrl(map, version);
  nav.push({ text: `v${version}`, link: release });
  return {
    releaseUrl: release,
    nav,
    sidebar: { "/": groups },
    socialLinks: [{ icon: "github", mode: "link", content: map.repository }],
  };
}
