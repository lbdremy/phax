// GitHub Markdown safety for model text placed in a pull request body or comment. Pure.

/**
 * `text` as an inline code span. The fence is one backtick longer than the longest backtick
 * run inside the text (CommonMark), padded with a space on each side when the text holds a
 * backtick.
 */
export function codeSpan(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longestRun + 1);
  return longestRun === 0 ? `${fence}${text}${fence}` : `${fence} ${text} ${fence}`;
}

// Model text in the body: `@scope/pkg` or `@name` outside a code span would
// mention a GitHub user or team and notify them, so each such token is
// rendered as code. Code spans and an `@` inside a word (an email) are left
// as they are.
export function withoutMentions(text: string): string {
  return text
    .split(/(`+[^`]*?`+)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(
            /(^|[^\w`])(@[\w-]+(?:\/[\w.-]*[\w-])?)/g,
            (_m, before: string, token: string) => `${before}\`${token}\``,
          ),
    )
    .join("");
}
