// The install command under the hero's actions (the home's `install`
// frontmatter, which the build checks against README.md), with a copy button.
import { useFrontmatter } from "@rspress/core/runtime";
import { useState } from "react";

// The test typecheck has no DOM library; the one browser API used here.
declare const navigator: { readonly clipboard?: { writeText(text: string): Promise<void> } };

export function InstallCommand() {
  const { frontmatter } = useFrontmatter();
  const command = frontmatter["install"];
  const [copied, setCopied] = useState(false);
  if (typeof command !== "string") return null;
  const copy = () => {
    navigator.clipboard
      ?.writeText(command)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      })
      .catch(() => setCopied(false));
  };
  return (
    <div className="phax-install">
      <code>
        <span className="phax-install__prompt" aria-hidden="true">
          $
        </span>{" "}
        {command}
      </code>
      <button type="button" className="phax-install__copy" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
