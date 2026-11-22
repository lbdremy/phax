// The llms.txt renderer for Rspress's `llms.llmsTxt` option. It reproduces
// Rspress 2.1.2's default llms.txt layout (generateLlmsTxt in
// @rspress/core's ssg-md/llms/llmsTxt.js) with one change: the blockquote
// under the title is the agent pitch, not the site's description, which stays
// the person pitch for the meta description and the link previews. The
// option is experimental; site:build's checkLlmsTxt guards the built file.
import type { LlmsTxtRenderer } from "@rspress/core";
import { AGENT_PITCH } from "./positioning.js";

export const renderLlmsTxt: LlmsTxtRenderer = (context) => {
  const summary =
    context.title === undefined || context.title === ""
      ? ""
      : `# ${context.title}\n\n> ${AGENT_PITCH}`;
  const lines: Array<string> = [];
  for (const section of context.sections) {
    lines.push(`\n## ${section.title}\n`);
    for (const page of section.pages) {
      const description =
        page.description === undefined || page.description === "" ? "" : `: ${page.description}`;
      lines.push(`- [${page.title}](${page.link})${description}`);
    }
  }
  if (summary === "") return lines.join("\n").trimStart();
  return lines.length > 0 ? `${summary}\n${lines.join("\n")}` : summary;
};
