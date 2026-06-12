export interface PrTitleCandidates {
  readonly configuredTitle?: string;
  readonly runTitle?: string;
  readonly phaseTitle?: string;
  readonly shortName: string;
}

export function selectPrTitle(candidates: PrTitleCandidates): string {
  const { configuredTitle, runTitle, phaseTitle, shortName } = candidates;

  if (configuredTitle !== undefined && configuredTitle.trim() !== "") {
    return configuredTitle.trim();
  }

  if (runTitle !== undefined && runTitle.trim() !== "") {
    return `PHAX: ${runTitle.trim()}`;
  }

  if (phaseTitle !== undefined && phaseTitle.trim() !== "") {
    return `PHAX: ${phaseTitle.trim()}`;
  }

  return `PHAX: ${shortName}`;
}
