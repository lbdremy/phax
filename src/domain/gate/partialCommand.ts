import { Either } from "effect";
import type { GateStep } from "../../schemas/phaxConfig.js";

export type PartialVariant = "files" | "diff";

export type PartialCommandRefusal =
  | { readonly kind: "construct"; readonly construct: string }
  | { readonly kind: "needs-placeholder" }
  | { readonly kind: "no-placeholder-allowed" }
  | { readonly kind: "empty-segment" }
  | { readonly kind: "empty-command" }
  | { readonly kind: "malformed-placeholder" }
  | { readonly kind: "leading-placeholder" };

interface PartialSegment {
  readonly text: string;
  readonly prefix: string;
}

export interface ParsedPartialCommand {
  readonly segments: readonly PartialSegment[];
}

const PLACEHOLDER = /<[a-z][a-z0-9-]*>/g;
const HAS_PLACEHOLDER = /<[a-z][a-z0-9-]*>/;
// What is left of a `<word>` once well-formed placeholders are removed, such
// as `<FILES>` or `<1st>`: named as a placeholder, not as a redirection.
const MALFORMED_PLACEHOLDER = /<[^\s<>|]+>/;
const MALFORMED = "malformed placeholder";

const UNPARSED = ["'", '"', "\\", "*"] as const;

function isUnparsed(construct: string): boolean {
  return (UNPARSED as readonly string[]).includes(construct);
}

// Checked on the raw string, in this order; the first one found is named.
// Placeholders are removed before `<` and `>` are tested, so only a stray one
// remains to match.
function findConstruct(command: string): string | undefined {
  if (/[\n\r]/.test(command)) return "line break";
  if (command.includes("$(")) return "$(";
  if (command.includes("`")) return "`";
  if (command.includes("&&")) return "&&";
  if (command.includes("||")) return "||";
  if (command.includes("&")) return "&";
  const bare = command.replace(PLACEHOLDER, "");
  if (MALFORMED_PLACEHOLDER.test(bare)) return MALFORMED;
  if (bare.includes(">>")) return ">>";
  if (bare.includes(">")) return ">";
  if (bare.includes("<")) return "<";
  if (command.includes(";")) return ";";
  // Not parsed: a quote, an escape or a glob would reach the allow rules
  // as written, and Claude Code reads `*` in a rule as a wildcard.
  for (const unparsed of UNPARSED) {
    if (command.includes(unparsed)) return unparsed;
  }
  return undefined;
}

function segmentPrefix(text: string): string {
  const words = text.split(" ");
  const at = words.findIndex((word) => HAS_PLACEHOLDER.test(word));
  return (at === -1 ? words : words.slice(0, at)).join(" ");
}

/**
 * Parses a partial command: pipes only, `<name>` placeholders, and for each
 * pipe segment the words a secure session is allowed to start with. A
 * placeholder glued inside a word ends the prefix before that word.
 */
export function parsePartialCommand(
  command: string,
  variant: PartialVariant,
): Either.Either<ParsedPartialCommand, PartialCommandRefusal> {
  if (command.trim() === "") return Either.left({ kind: "empty-command" });
  const construct = findConstruct(command);
  if (construct === MALFORMED) return Either.left({ kind: "malformed-placeholder" });
  if (construct !== undefined) return Either.left({ kind: "construct", construct });
  const texts = command.split("|").map((segment) => segment.trim().split(/\s+/).join(" "));
  if (texts.some((text) => text === "")) return Either.left({ kind: "empty-segment" });
  // A placeholder anywhere in a segment's first word (`<files>`, `x<files>`,
  // `"<files>"`) leaves it no prefix to allow.
  if (texts.some((text) => HAS_PLACEHOLDER.test(text.split(" ")[0] ?? ""))) {
    return Either.left({ kind: "leading-placeholder" });
  }
  const holdsPlaceholder = HAS_PLACEHOLDER.test(command);
  if (variant === "files" && !holdsPlaceholder) return Either.left({ kind: "needs-placeholder" });
  if (variant === "diff" && holdsPlaceholder) {
    return Either.left({ kind: "no-placeholder-allowed" });
  }
  return Either.right({
    segments: texts.map((text) => ({ text, prefix: segmentPrefix(text) })),
  });
}

/** The message tail the loader appends after `<path>.partial.<variant>: `. */
export function describePartialRefusal(refusal: PartialCommandRefusal): string {
  switch (refusal.kind) {
    case "construct":
      return isUnparsed(refusal.construct)
        ? `"${refusal.construct}" is not allowed in a partial command; phax parses no quotes, escapes or globs, so wrap such a command in a committed script`
        : `"${refusal.construct}" is not allowed in a partial command; join commands with "|" only`;
    case "needs-placeholder":
      return "a files command needs a placeholder such as <files>";
    case "no-placeholder-allowed":
      return "a diff command takes no placeholder";
    case "empty-command":
      return "a partial command is empty";
    case "malformed-placeholder":
      return "a placeholder is lowercase letters, digits and -, starting with a letter, such as <files>";
    case "empty-segment":
      return 'a partial command has an empty segment; join commands with "|" only';
    case "leading-placeholder":
      return "a command segment cannot start with a placeholder; it would allow every command";
  }
}

/**
 * Every pipe segment's prefix, over every declared variant of every step, in
 * step order, files before diff, deduplicated. Runs on loaded config only, so a
 * refusal here is a defect.
 */
export function partialAllowPrefixes(steps: readonly GateStep[]): readonly string[] {
  const prefixes: string[] = [];
  for (const step of steps) {
    for (const variant of ["files", "diff"] as const) {
      const command = step.partial?.[variant];
      if (command === undefined) continue;
      const parsed = parsePartialCommand(command, variant);
      if (Either.isLeft(parsed)) {
        throw new Error(
          `partial.${variant} of "${step.command}" was not refused at load: ${describePartialRefusal(parsed.left)}`,
        );
      }
      for (const segment of parsed.right.segments) {
        if (!prefixes.includes(segment.prefix)) prefixes.push(segment.prefix);
      }
    }
  }
  return prefixes;
}

export interface ProfilePartialPrefixes {
  /** The profile's name, `<workspace>/<profile>` for a workspace's own. */
  readonly profile: string;
  readonly prefixes: readonly string[];
}

/**
 * The prefixes each gate profile's partial commands allow, for the profiles
 * that declare any: the top-level ones in order, then each workspace's.
 */
export function partialPrefixesByProfile(config: {
  readonly gateProfiles: Readonly<Record<string, readonly GateStep[]>>;
  readonly workspaces?:
    | readonly {
        readonly id: string;
        readonly gateProfiles?: Readonly<Record<string, readonly GateStep[]>> | undefined;
      }[]
    | undefined;
}): readonly ProfilePartialPrefixes[] {
  const named: [string, readonly GateStep[]][] = [
    ...Object.entries(config.gateProfiles),
    ...(config.workspaces ?? []).flatMap((workspace) =>
      Object.entries(workspace.gateProfiles ?? {}).map(
        ([profile, steps]): [string, readonly GateStep[]] => [`${workspace.id}/${profile}`, steps],
      ),
    ),
  ];
  return named
    .map(([profile, steps]) => ({ profile, prefixes: partialAllowPrefixes(steps) }))
    .filter((entry) => entry.prefixes.length > 0);
}
