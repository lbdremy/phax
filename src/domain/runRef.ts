import { Result } from "effect";
import { decodeNamespace, decodeShortName, type ShortName } from "./branded.js";

export type RunRef = { namespace: string | undefined; shortName: string };

export function runKey(namespace: string, shortName: string): string {
  return `${namespace}.${shortName}`;
}

export function formatQualifiedName(namespace: string, shortName: string): string {
  return runKey(namespace, shortName);
}

export function parseRunRef(input: string): Result.Result<RunRef, string> {
  if (input === "") {
    return Result.fail("Run reference cannot be empty.");
  }

  const dotIndex = input.indexOf(".");

  if (dotIndex === -1) {
    const result = decodeShortName(input);
    if (Result.isFailure(result)) {
      return Result.fail(
        `"${input}" is not a valid run short name. Short names must match ^[a-z][a-z0-9-]*$ and be 1–64 characters.`,
      );
    }
    return Result.succeed({ namespace: undefined, shortName: result.success });
  }

  const namespaceStr = input.slice(0, dotIndex);
  const shortNameStr = input.slice(dotIndex + 1);

  if (namespaceStr === "") {
    return Result.fail(
      `"${input}" has an empty namespace part. Use the form <namespace>.<shortName>.`,
    );
  }

  if (shortNameStr === "") {
    return Result.fail(
      `"${input}" has an empty short-name part. Use the form <namespace>.<shortName>.`,
    );
  }

  if (shortNameStr.includes(".")) {
    return Result.fail(
      `"${input}" contains more than one dot. Use the form <namespace>.<shortName>.`,
    );
  }

  const nsResult = decodeNamespace(namespaceStr);
  if (Result.isFailure(nsResult)) {
    return Result.fail(
      `"${namespaceStr}" is not a valid namespace. Namespaces must match ^[a-z][a-z0-9-]*$ and be 1–64 characters.`,
    );
  }

  const shortResult = decodeShortName(shortNameStr);
  if (Result.isFailure(shortResult)) {
    return Result.fail(
      `"${shortNameStr}" is not a valid run short name. Short names must match ^[a-z][a-z0-9-]*$ and be 1–64 characters.`,
    );
  }

  return Result.succeed({ namespace: nsResult.success, shortName: shortResult.success });
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
): Result.Result<{ namespace: string; shortName: string }, string> {
  const result = parseRunRef(key);
  if (Result.isFailure(result)) {
    return Result.fail(result.failure);
  }
  if (result.success.namespace === undefined) {
    return Result.fail(
      `"${key}" is an unqualified short name. A run key must be in the form <namespace>.<shortName>.`,
    );
  }
  const { namespace, shortName } = result.success;
  return Result.succeed({ namespace, shortName });
}
