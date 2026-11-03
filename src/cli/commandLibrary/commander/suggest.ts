// Gain carried for upstream (a refusal suggests a name): an unknown option or command the runner
// refuses before Commander reads the call is followed by the closest declared names, as Commander
// writes its own refusals (`(Did you mean --active?)`), so a person reads one wording whichever
// of the two refused the call. The rules are Commander 12's `suggestSimilar`: an edit distance
// with transpositions, at most 3 edits, a similarity above 0.4, no one-character guess.

const MAX_DISTANCE = 3;
const MIN_SIMILARITY = 0.4;

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > MAX_DISTANCE) return Math.max(a.length, b.length);
  const d: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) d[i] = [i];
  for (let j = 0; j <= b.length; j += 1) (d[0] as number[])[j] = j;
  for (let j = 1; j <= b.length; j += 1) {
    for (let i = 1; i <= a.length; i += 1) {
      const row = d[i] as number[];
      const above = d[i - 1] as number[];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min((above[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (above[j - 1] ?? 0) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j] ?? 0, ((d[i - 2] as number[])[j - 2] ?? 0) + 1);
      }
    }
  }
  return (d[a.length] as number[])[b.length] ?? 0;
}

/** The line that follows a refusal of `word`: `\n(Did you mean <name>?)`, or
 *  `\n(Did you mean one of <names>?)`, or "" when no candidate is close. Options are compared
 *  without their leading `--`. */
export function suggestSimilar(word: string, candidates: ReadonlyArray<string>): string {
  const options = word.startsWith("--");
  const strip = (name: string): string => (options ? name.slice(2) : name);
  const target = strip(word);
  let similar: string[] = [];
  let best = MAX_DISTANCE;
  for (const candidate of new Set(candidates.map(strip))) {
    if (candidate.length <= 1) continue;
    const distance = editDistance(target, candidate);
    const length = Math.max(target.length, candidate.length);
    if ((length - distance) / length <= MIN_SIMILARITY) continue;
    if (distance < best) {
      best = distance;
      similar = [candidate];
    } else if (distance === best) {
      similar.push(candidate);
    }
  }
  const named = similar
    .toSorted((a, b) => a.localeCompare(b))
    .map((name) => (options ? `--${name}` : name));
  if (named.length > 1) return `\n(Did you mean one of ${named.join(", ")}?)`;
  if (named.length === 1) return `\n(Did you mean ${named[0] ?? ""}?)`;
  return "";
}
