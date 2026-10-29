// The submodule paths a .gitmodules file lists: the value of every
// `path = <value>` line, in file order. Pure: the caller reads the file.

/**
 * The submodule paths of a .gitmodules text. A value is trimmed, loses one
 * pair of surrounding double quotes and its trailing slashes. Comment lines
 * (`#`, `;`) and every other key are ignored.
 */
export function parseGitmodulesPaths(text: string): readonly string[] {
  const paths: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
    const match = /^path\s*=\s*(.*)$/.exec(trimmed);
    if (match === null) continue;
    const value = (match[1] ?? "")
      .trim()
      .replace(/^"(.*)"$/, "$1")
      .replace(/\/+$/, "");
    if (value !== "") paths.push(value);
  }
  return paths;
}
