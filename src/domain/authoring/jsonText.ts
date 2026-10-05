// A model's final message should be a bare JSON object, but it sometimes wraps
// it in a ```json fence or surrounds it with prose ("Writing the document
// now.") despite the prompt forbidding both. This returns the text the caller
// should JSON.parse: the message with one surrounding fence stripped when that
// parses, else the last balanced top-level object amid prose that parses to a
// plain object, else the fence-stripped text (so the caller's JSON.parse throws
// and its own refusal applies). Shared by plan extraction and headless
// authoring, whose sessions both return a JSON object as their final message.
export function extractJsonDocumentText(text: string): string {
  const stripped = stripOneCodeFence(text);
  if (parses(stripped)) return stripped;

  let found: string | undefined;
  for (const candidate of topLevelObjectCandidates(text)) {
    if (isPlainObjectJson(candidate)) found = candidate;
  }
  return found ?? stripped;
}

function stripOneCodeFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const match = trimmed.match(fence);
  return match?.[1]?.trim() ?? trimmed;
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function isPlainObjectJson(text: string): boolean {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

// Balanced `{…}` groups, in order. Outside a group only `{` matters (quotes in
// prose are ignored); inside, braces count only outside string literals, where
// a backslash escapes the next character. A group that never closes resumes the
// search at the next `{` after its start, so a stray `{` cannot hide a document.
function* topLevelObjectCandidates(text: string): Generator<string> {
  let start = text.indexOf("{");
  while (start !== -1) {
    const end = closingBraceIndex(text, start);
    if (end === -1) {
      start = text.indexOf("{", start + 1);
    } else {
      yield text.slice(start, end + 1);
      start = text.indexOf("{", end + 1);
    }
  }
}

function closingBraceIndex(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
