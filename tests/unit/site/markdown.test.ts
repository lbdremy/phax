import { describe, expect, it } from "vitest";
import { renderReleaseNotes } from "../../../scripts/releaseNotes.js";
import { applyEdits, transformMarkdown } from "../../../site/build/markdown.js";
import { fullInput } from "../releaseNotes/inputs.js";

function render(text: string): {
  text: string;
  ids: ReadonlyArray<string>;
  findings: ReadonlyArray<string>;
} {
  const transform = transformMarkdown("docs/guide.md", text);
  return {
    text: applyEdits(text, transform.edits),
    ids: transform.headings.map((heading) => heading.id),
    findings: transform.findings.map((finding) => finding.message),
  };
}

describe("transformMarkdown", () => {
  it("keeps placeholders and braces literal and drops HTML comments", () => {
    const source = [
      "## Setup",
      "",
      "<!-- maintainers: keep this short -->",
      "Name the phase <short-name> and link it as {#phase-01-setup}.",
      "Inline <!-- hidden --> comment.",
      "",
    ].join("\n");
    const output = render(source);
    expect(output.findings).toEqual([]);
    expect(output.text).toContain(
      "Name the phase \\<short-name\\> and link it as \\{#phase-01-setup\\}.",
    );
    expect(output.text).toContain("Inline  comment.");
    expect(output.text).not.toContain("maintainers");
    expect(output.text).not.toContain("hidden");
  });

  it("leaves code spans and fenced code untouched", () => {
    const source = [
      "Run `phax run <plan> {--dry}` first.",
      "",
      "```bash",
      "phax run <short-name> # {not an id}",
      "<!-- kept in code -->",
      "```",
      "",
    ].join("\n");
    const output = render(source);
    expect(output.text).toContain("`phax run <plan> {--dry}`");
    expect(output.text).toContain(
      "phax run <short-name> # {not an id}\n<!-- kept in code -->\n```",
    );
  });

  it("does not double-escape characters the source already escapes", () => {
    expect(render("Use \\<name\\> and \\{x\\}.\n").text).toBe("Use \\<name\\> and \\{x\\}.\n");
  });

  it("keeps quote markers on continuation lines", () => {
    expect(render("> one {a}\n> two <id>\n").text).toBe("> one \\{a\\}\n> two \\<id\\>\n");
  });

  it("rewrites angle autolinks as Markdown links", () => {
    expect(render("See <https://example.com/docs> or mail <a@b.co>.\n").text).toBe(
      "See [https://example.com/docs](https://example.com/docs) or mail [a@b.co](mailto:a@b.co).\n",
    );
  });

  it("fails on a raw HTML element, naming the file and line", () => {
    const output = render("Intro.\n\n<details>\n<summary>More</summary>\n\nBody.\n\n</details>\n");
    expect(output.findings).toEqual([
      "✗ docs/guide.md:3: raw HTML <details> is not supported; write Markdown",
      "✗ docs/guide.md:8: raw HTML <details> is not supported; write Markdown",
    ]);
  });

  it("gives every heading its GitHub slug as an explicit id, suffixing duplicates", () => {
    const source = [
      "# Tool",
      "## Run",
      "### Options",
      "## Resume",
      "### Options",
      "## CLI specification (`tool.usage.kdl`)",
      "## Compliance review & publishing",
      "",
    ].join("\n");
    const output = render(source);
    expect(output.ids).toEqual([
      "tool",
      "run",
      "options",
      "resume",
      "options-1",
      "cli-specification-toolusagekdl",
      "compliance-review--publishing",
    ]);
    expect(output.text).toContain("### Options \\{#options-1\\}\n");
    expect(output.text).toContain(
      "## CLI specification (`tool.usage.kdl`) \\{#cli-specification-toolusagekdl\\}\n",
    );
  });

  it("applies only the edits inside a range", () => {
    const source = "## A {x}\n\ntext {y}\n\n## B\n";
    const transform = transformMarkdown("README.md", source);
    const cut = source.indexOf("## B");
    expect(applyEdits(source, transform.edits, 0, cut)).toBe(
      "## A \\{x\\} \\{#a-x\\}\n\ntext \\{y\\}\n\n",
    );
    expect(applyEdits(source, transform.edits, cut)).toBe("## B \\{#b\\}\n");
  });
});

function renderNotes(path: string, text: string) {
  const transform = transformMarkdown(path, text);
  return {
    text: applyEdits(text, transform.edits),
    findings: transform.findings.map((finding) => finding.message),
  };
}

function item(summary: string): string {
  return [
    "- A sentence. `phax x`",
    "",
    "  Now:",
    "",
    "  ```text",
    "  now <details>",
    "  ```",
    "",
    "  <details>",
    `  <summary>${summary}</summary>`,
    "",
    "  ```text",
    "  <details>",
    "  ```",
    "",
    "  </details>",
    "",
  ].join("\n");
}

describe("release notes", () => {
  const notes = item("Before");

  it("turns the builder's fold inside a list item into a container at the item's indentation", () => {
    const output = renderNotes("docs/releases/0.28.0.md", notes);
    expect(output.findings).toEqual([]);
    expect(output.text).toContain(
      "  :::details Before\n\n  ```text\n  <details>\n  ```\n\n  :::\n",
    );
    expect(output.text).toContain("  ```text\n  now <details>\n  ```\n");
  });

  it("turns the fold at top level into a container at the margin", () => {
    const fold = [
      "<details>",
      "<summary>Before</summary>",
      "",
      "```text",
      "<details>",
      "```",
      "",
      "</details>",
      "",
    ].join("\n");
    const output = renderNotes("docs/releases/0.28.0.md", fold);
    expect(output.findings).toEqual([]);
    expect(output.text).toBe(":::details Before\n\n```text\n<details>\n```\n\n:::\n");
  });

  it("turns the fold inside a nested list into a container at the nested item's indentation", () => {
    const nested = [
      "- An outer bullet.",
      "",
      ...notes
        .trimEnd()
        .split("\n")
        .map((line) => (line === "" ? "" : `  ${line}`)),
      "",
    ].join("\n");
    const output = renderNotes("docs/releases/0.28.0.md", nested);
    expect(output.findings).toEqual([]);
    expect(output.text).toContain(
      "    :::details Before\n\n    ```text\n    <details>\n    ```\n\n    :::\n",
    );
    expect(output.text).not.toContain("<summary>");
  });

  it("accepts the full made-up notes the builder writes", () => {
    const written = renderReleaseNotes(fullInput).markdown;
    expect(renderNotes("docs/releases/4.2.0.md", written).findings).toEqual([]);
  });

  it.each(["After", "Before and after", "Before (old)"])(
    "refuses a fold whose summary is %s",
    (summary) => {
      const output = renderNotes("docs/releases/0.28.0.md", item(summary));
      expect(output.findings).toEqual([
        expect.stringContaining("raw HTML <details> is not supported; write Markdown"),
      ]);
    },
  );

  it("still refuses any other raw HTML in a release note", () => {
    const output = renderNotes("docs/releases/0.28.0.md", "# phax\n\n<div>x</div>\n");
    expect(output.findings).toEqual([
      "✗ docs/releases/0.28.0.md:3: raw HTML <div> is not supported; write Markdown",
    ]);
  });

  it("still refuses <details> outside docs/releases/", () => {
    expect(renderNotes("docs/guide.md", notes).findings).not.toEqual([]);
  });
});
