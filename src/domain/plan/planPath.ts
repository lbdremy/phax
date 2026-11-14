// The one rule that reads a written plan path. Canonical means repository-
// relative, `/` separators, no empty, `.` or `..` segment, no leading or
// trailing `/`, no backslash. Pure: no I/O. Glob characters are ordinary.

export type UnplannableReason =
  | "empty"
  | "absolute"
  | "leaves-repository"
  | "directory"
  | "backslash";

export type PlanPathReading =
  | { readonly kind: "canonical"; readonly path: string }
  | { readonly kind: "rewritable"; readonly written: string; readonly canonical: string }
  | { readonly kind: "unplannable"; readonly written: string; readonly reason: UnplannableReason };

export function readPlanPath(written: string): PlanPathReading {
  const unplannable = (reason: UnplannableReason): PlanPathReading => ({
    kind: "unplannable",
    written,
    reason,
  });
  if (written === "") return unplannable("empty");
  if (written.includes("\\")) return unplannable("backslash");
  if (written.startsWith("/")) return unplannable("absolute");
  const kept: string[] = [];
  for (const segment of written.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (kept.length === 0) return unplannable("leaves-repository");
      kept.pop();
      continue;
    }
    kept.push(segment);
  }
  if (kept.length === 0) return unplannable("empty");
  if (written.endsWith("/")) return unplannable("directory");
  const canonical = kept.join("/");
  return canonical === written
    ? { kind: "canonical", path: written }
    : { kind: "rewritable", written, canonical };
}

export function isCanonicalPlanPath(s: string): boolean {
  return readPlanPath(s).kind === "canonical";
}

export function describeUnplannable(reason: UnplannableReason): string {
  switch (reason) {
    case "empty":
      return "is empty";
    case "absolute":
      return "is absolute";
    case "leaves-repository":
      return "leaves the repository";
    case "directory":
      return "names a directory";
    case "backslash":
      return "contains a backslash";
  }
}

export function describeNotCanonical(canonical: string): string {
  return `is not canonical: write ${JSON.stringify(canonical)}`;
}

/** The text for a non-canonical reading. */
export function describePlanPathProblem(
  reading: Exclude<PlanPathReading, { kind: "canonical" }>,
): string {
  return reading.kind === "rewritable"
    ? describeNotCanonical(reading.canonical)
    : describeUnplannable(reading.reason);
}
