import { Either } from "effect";
import { GRANT_PATTERN, type ApprovedBy } from "../../schemas/approvedBy.js";

/** Who performs an approval: a machine and its grant, the operator, or no one recorded. */
export type Arbiter = ApprovedBy;

/** An arbiter a gesture resolves to: never unattributed. */
export type ResolvedArbiter = Exclude<Arbiter, { readonly kind: "unattributed" }>;

/** What `--by` declares: the operator, or a machine and its grant. */
export type ArbiterDeclaration =
  | { readonly kind: "operator" }
  | { readonly kind: "machine"; readonly grant: string };

const BY_FORMS = "`--by operator` or `--by machine:<grant>`";

/** Parses a raw `--by` value. A refusal is the message to print. */
export function parseArbiterDeclaration(raw: string): Either.Either<ArbiterDeclaration, string> {
  if (raw === "operator") return Either.right({ kind: "operator" });
  if (raw.startsWith("machine:")) {
    const grant = raw.slice("machine:".length);
    if (GRANT_PATTERN.test(grant)) return Either.right({ kind: "machine", grant });
    return Either.left(
      `--by ${raw}: a grant is a kebab-case slug matching ${GRANT_PATTERN.source}`,
    );
  }
  return Either.left(`--by ${raw} is not an arbiter — pass ${BY_FORMS}`);
}

export interface ArbiterFacts {
  readonly declared: ArbiterDeclaration | null;
  readonly stdinIsTerminal: boolean;
  /** `git config user.name`; null when unset or empty. Read only when `needsOperatorName`. */
  readonly gitUserName: string | null;
}

/** Whether resolving `declared` names the operator, so needs the git user.name. */
export function needsOperatorName(
  declared: ArbiterDeclaration | null,
  stdinIsTerminal: boolean,
): boolean {
  return declared === null ? stdinIsTerminal : declared.kind === "operator";
}

/**
 * Resolves who performs a gesture: a declared machine; the operator when
 * declared, or by default from a terminal, named by the git user.name. Without
 * a terminal nothing is assumed. A refusal is the message to print.
 */
export function resolveArbiter(facts: ArbiterFacts): Either.Either<ResolvedArbiter, string> {
  const { declared, stdinIsTerminal, gitUserName } = facts;
  if (declared?.kind === "machine") return Either.right({ kind: "machine", grant: declared.grant });
  if (!needsOperatorName(declared, stdinIsTerminal)) {
    return Either.left(`no terminal and no --by — pass ${BY_FORMS}`);
  }
  if (gitUserName === null || gitUserName.length === 0) {
    return Either.left(
      'the operator is named by git user.name, which is not set — set it with `git config user.name "<name>"`',
    );
  }
  return Either.right({ kind: "operator", name: gitUserName });
}

/** `machine (<grant>)`, `operator (<name>)` or `unattributed`. */
export function describeArbiter(arbiter: Arbiter): string {
  switch (arbiter.kind) {
    case "machine":
      return `machine (${arbiter.grant})`;
    case "operator":
      return `operator (${arbiter.name})`;
    case "unattributed":
      return "unattributed";
  }
}
