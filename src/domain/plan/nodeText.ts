import type { Nodes } from "mdast";

// The flattened text of an mdast node, as `mdast-util-to-string` reads it with its default options
// (a value, else an image's alt, else the children's text in order), but walked with an explicit
// stack. The library recurses once per nesting level, so a list item holding thousands of nested
// block quotes, or a paragraph with thousands of nested emphasis, overflows the call stack. This
// walk uses the heap, so any depth the Markdown parser returns reads as text.
export function nodeText(root: Nodes): string {
  const parts: string[] = [];
  const stack: Nodes[] = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if ("value" in node) {
      parts.push(node.value);
    } else if ("alt" in node && node.alt) {
      parts.push(node.alt);
    } else if ("children" in node) {
      for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]!);
    }
  }
  return parts.join("");
}
