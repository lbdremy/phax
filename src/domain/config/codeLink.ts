// The code link of a process repository (spec code-repository): where its code repository is
// checked out, and the sentences that refuse a bad link. Pure: the checks against the
// repository itself live in src/app/codeLink.ts.

/** Why `root` cannot name a directory inside the repository, or null when it is canonical. */
export function codeRootProblem(root: string): string | null {
  const inside = "must be a relative path inside this repository";
  if (root === "." || root === "") return inside;
  if (root.startsWith("/") || /^[A-Za-z]:/.test(root)) return inside;
  const segments = root.replaceAll("\\", "/").split("/");
  if (segments.includes("..")) return inside;
  const canonical = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (canonical === "") return inside;
  return canonical === root ? null : `must be written ${canonical}`;
}

/** A refusal of the link's root, as `phax validate` and the other commands print it. */
export function codeRootMessage(root: string, reason: string): string {
  return `code.root "${root}": ${reason}`;
}

export const CODE_ROOT_MISSING = "does not exist";
export const CODE_ROOT_NOT_TOP_LEVEL = "not the top level of a git repository";

export function codeRootNotIgnored(root: string): string {
  return `not ignored by this repository — add /${root}/ to .gitignore`;
}
