// GitHub-faithful Markdown for the docs site. A source is parsed once with
// mdast and the GFM extensions, then edited at node offsets — never
// re-serialised — so every unedited byte stays as written. The output reads
// the same whether Rspress compiles it as Markdown or as MDX: HTML comments
// are dropped, `<`, `>`, `{` and `}` in text are backslash-escaped,
// placeholders such as `<short-name>` stay literal, `<url>` autolinks become
// `[url](url)`, and every heading carries its GitHub slug as an explicit id.
import GithubSlugger from "github-slugger";
import type { Heading, Nodes, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

export function parseMarkdown(text: string): Root {
  return fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

/** A node's plain text as mdast-util-to-string gives it; names README sections. */
export function plainText(node: Nodes): string {
  return toString(node);
}

/** A replacement of `text.slice(start, end)`; an insertion when `start === end`. */
export interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface SourceHeading {
  /** GitHub's anchor for the heading, unique within its source. */
  readonly id: string;
  readonly depth: number;
  /** Offset of the heading's first character in the source. */
  readonly offset: number;
  readonly line: number;
}

export interface MarkdownFinding {
  /** Offset in the source the finding is about. */
  readonly offset: number;
  /** `✗ <path>:<line>: …` */
  readonly message: string;
}

export interface MarkdownTransform {
  readonly edits: ReadonlyArray<Edit>;
  readonly headings: ReadonlyArray<SourceHeading>;
  readonly findings: ReadonlyArray<MarkdownFinding>;
}

/**
 * Standard HTML element names. A source using one of them as a tag is raw
 * HTML, which the site does not render; any other tag-like text (`<branch>`,
 * `<short-name>`) is a placeholder kept as literal text.
 */
const HTML_ELEMENTS = new Set(
  (
    "a abbr address area article aside audio b base bdi bdo blockquote body br button canvas " +
    "caption center cite code col colgroup data datalist dd del details dfn dialog div dl dt em " +
    "embed fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 head header hgroup hr " +
    "html i iframe img input ins kbd label legend li link main map mark menu meta meter nav " +
    "noscript object ol optgroup option output p param picture pre progress q rp rt ruby s samp " +
    "script search section select slot small source span strong style sub summary sup svg table " +
    "tbody td template textarea tfoot th thead time title tr track u ul var video wbr"
  ).split(" "),
);

const COMMENT = /<!--[\s\S]*?-->/g;
const TAG_NAME = /^<\/?([A-Za-z][A-Za-z0-9-]*)/;
const ESCAPED = new Set(["<", ">", "{", "}"]);

/** Text a heading's GitHub slug is computed from: its rendered text, without HTML or image alt. */
function slugText(heading: Heading): string {
  return toString(heading, { includeHtml: false, includeImageAlt: false });
}

/**
 * The edits that make `text` GitHub-faithful on the site, every heading's
 * GitHub id, and every finding. `path` names the source in findings.
 */
export function transformMarkdown(path: string, text: string): MarkdownTransform {
  const edits: Array<Edit> = [];
  const headings: Array<SourceHeading> = [];
  const findings: Array<MarkdownFinding> = [];
  const slugger = new GithubSlugger();
  const fail = (offset: number, line: number, message: string): void => {
    findings.push({ offset, message: `✗ ${path}:${line}: ${message}` });
  };

  const escapeTextRange = (start: number, end: number): void => {
    let atLineStart = false;
    for (let index = start; index < end; index++) {
      const char = text.charAt(index);
      if (char === "\n") {
        atLineStart = true;
        continue;
      }
      // A continuation line's container prefix (indentation, `>` quote markers)
      // lies inside the text node's range but is not text.
      if (atLineStart && (char === " " || char === "\t" || char === ">")) continue;
      atLineStart = false;
      if (!ESCAPED.has(char)) continue;
      let backslashes = 0;
      while (index - backslashes - 1 >= start && text.charAt(index - backslashes - 1) === "\\") {
        backslashes++;
      }
      if (backslashes % 2 === 0) edits.push({ start: index, end: index, text: "\\" });
    }
  };

  const visit = (node: Nodes): void => {
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    const line = node.position?.start.line ?? 0;
    if (start === undefined || end === undefined) return;
    switch (node.type) {
      case "code":
      case "inlineCode":
      case "definition":
      case "image":
      case "imageReference":
        return;
      case "text":
        escapeTextRange(start, end);
        return;
      case "html": {
        const kept = node.value.replace(COMMENT, "");
        if (kept.trim() === "") {
          edits.push({ start, end, text: "" });
          return;
        }
        const tag = TAG_NAME.exec(kept.trimStart())?.[1]?.toLowerCase();
        if (tag !== undefined && HTML_ELEMENTS.has(tag)) {
          fail(start, line, `raw HTML <${tag}> is not supported; write Markdown`);
          return;
        }
        // Edit the raw range, not the node's value, so that container
        // prefixes on continuation lines survive.
        let cursor = start;
        for (const comment of text.slice(start, end).matchAll(COMMENT)) {
          const commentStart = start + comment.index;
          escapeTextRange(cursor, commentStart);
          cursor = commentStart + comment[0].length;
          edits.push({ start: commentStart, end: cursor, text: "" });
        }
        escapeTextRange(cursor, end);
        return;
      }
      case "link":
        if (text.charAt(start) === "<" && text.charAt(end - 1) === ">") {
          edits.push({ start, end, text: `[${toString(node)}](${node.url})` });
          return;
        }
        break;
      case "heading": {
        const id = slugger.slug(slugText(node));
        headings.push({ id, depth: node.depth, offset: start, line });
        if (toString(node).includes("{#")) {
          fail(start, line, `a heading's text contains "{#", which reads as an id`);
        }
        const last = node.children.at(-1);
        const insertAt = last?.position?.end.offset;
        node.children.forEach(visit);
        if (insertAt !== undefined && id !== "") {
          edits.push({ start: insertAt, end: insertAt, text: ` \\{#${id}\\}` });
        }
        return;
      }
      default:
        break;
    }
    if ("children" in node) (node.children as ReadonlyArray<Nodes>).forEach(visit);
  };

  visit(parseMarkdown(text));
  edits.sort((left, right) => left.start - right.start || left.end - right.end);
  return { edits, headings, findings };
}

/** `text.slice(start, end)` with every edit lying inside that range applied. */
export function applyEdits(
  text: string,
  edits: ReadonlyArray<Edit>,
  start = 0,
  end = text.length,
): string {
  let output = "";
  let cursor = start;
  for (const edit of edits) {
    if (edit.start < start || edit.end > end) continue;
    if (edit.start === edit.end && edit.start === end && end !== text.length) continue;
    output += text.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return output + text.slice(cursor, end);
}
