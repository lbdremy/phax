import { Either } from "effect";
import { decodeNamespace, decodeShortName, type ShortName } from "./branded.js";

export type RunRef = { namespace: string | undefined; shortName: string };

export function runKey(namespace: string, shortName: string): string {
  return `${namespace}.${shortName}`;
}

export function formatQualifiedName(namespace: string, shortName: string): string {
  return runKey(namespace, shortName);
}

export function parseRunRef(input: string): Either.Either<RunRef, string> {
  if (input === "") {
    return Either.left("Run reference cannot be empty.");
  }

  const dotIndex = input.indexOf(".");

  if (dotIndex === -1) {
    const result = decodeShortName(input);
    if (Either.isLeft(result)) {
      return Either.left(
        `"${input}" is not a valid run short name. Short names must match ^[a-z][a-z0-9-]*$ and be 1–64 characters.`,
      );
    }
    return Either.right({ namespace: undefined, shortName: result.right });
  }

  const namespaceStr = input.slice(0, dotIndex);
  const shortNameStr = input.slice(dotIndex + 1);

  if (namespaceStr === "") {
    return Either.left(
      `"${input}" has an empty namespace part. Use the form <namespace>.<shortName>.`,
    );
  }

  if (shortNameStr === "") {
    return Either.left(
      `"${input}" has an empty short-name part. Use the form <namespace>.<shortName>.`,
    );
  }

  if (shortNameStr.includes(".")) {
    return Either.left(
      `"${input}" contains more than one dot. Use the form <namespace>.<shortName>.`,
    );
  }

  const nsResult = decodeNamespace(namespaceStr);
  if (Either.isLeft(nsResult)) {
    return Either.left(
      `"${namespaceStr}" is not a valid namespace. Namespaces must match ^[a-z][a-z0-9-]*$ and be 1–64 characters.`,
    );
  }

  const shortResult = decodeShortName(shortNameStr);
  if (Either.isLeft(shortResult)) {
    return Either.left(
      `"${shortNameStr}" is not a valid run short name. Short names must match ^[a-z][a-z0-9-]*$ and be 1–64 characters.`,
    );
  }

  return Either.right({ namespace: nsResult.right, shortName: shortResult.right });
}

export function nextAvailableShortName(
  base: ShortName,
  isUsed: (name: string) => boolean,
): ShortName {
  if (!isUsed(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const trimmed = base.slice(0, 64 - suffix.length).replace(/-+$/g, "");
    const candidate = `${trimmed}${suffix}` as ShortName;
    if (!isUsed(candidate)) return candidate;
  }
}

export function parseRunKey(
  key: string,
): Either.Either<{ namespace: string; shortName: string }, string> {
  const result = parseRunRef(key);
  if (Either.isLeft(result)) {
    return Either.left(result.left);
  }
  if (result.right.namespace === undefined) {
    return Either.left(
      `"${key}" is an unqualified short name. A run key must be in the form <namespace>.<shortName>.`,
    );
  }
  const { namespace, shortName } = result.right;
  return Either.right({ namespace, shortName });
}
