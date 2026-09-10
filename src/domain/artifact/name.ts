import type { ArtifactKind } from "./status.js";

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isSlug(s: string): boolean {
  return SLUG_PATTERN.test(s);
}

export interface ArtifactName {
  readonly stamp: string;
  readonly slug: string;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

export function formatStamp(nowIso: string): string {
  const date = new Date(nowIso);
  const yy = pad2(date.getUTCFullYear() % 100);
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const min = pad2(date.getUTCMinutes());
  return `${yy}${mm}${dd}${hh}${min}`;
}

export function buildArtifactName(kind: ArtifactKind, nowIso: string, slug: string): string {
  const stamp = formatStamp(nowIso);
  return kind === "spec" ? `${stamp}-${slug}.md` : `${stamp}-${slug}-plan.md`;
}

const STAMP_PATTERN = /^[0-9]{10}$/;

export function parseArtifactName(kind: ArtifactKind, fileName: string): ArtifactName | null {
  if (!fileName.endsWith(".md")) return null;
  const base = fileName.slice(0, -3);

  let rest: string;
  if (kind === "plan") {
    if (!base.endsWith("-plan")) return null;
    rest = base.slice(0, -"-plan".length);
  } else {
    if (base.endsWith("-plan")) return null;
    rest = base;
  }

  const separatorIndex = rest.indexOf("-");
  if (separatorIndex === -1) return null;
  const stamp = rest.slice(0, separatorIndex);
  const slug = rest.slice(separatorIndex + 1);

  if (!STAMP_PATTERN.test(stamp)) return null;
  if (!isSlug(slug)) return null;

  return { stamp, slug };
}

export function artifactNameGrammar(kind: ArtifactKind): string {
  return kind === "spec" ? "<YYMMDDHHMM>-<slug>.md" : "<YYMMDDHHMM>-<slug>-plan.md";
}
