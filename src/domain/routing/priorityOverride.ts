import type { ModelRouting } from "../../schemas/modelRouting.js";
import type { ProviderId } from "./types.js";

type ParseSuccess<A> = { readonly ok: true; readonly value: A };
type ParseFailure = { readonly ok: false; readonly error: string };
export type ParseResult<A> = ParseSuccess<A> | ParseFailure;

export type NonEmptyArray<T> = readonly [T, ...T[]];

const VALID_PROVIDER_IDS: readonly ProviderId[] = ["claude-code", "mistral-vibe", "codex-cli"];

export function parseProviderPriority(raw: string): ParseResult<NonEmptyArray<ProviderId>> {
  const tokens = raw
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return { ok: false, error: "--provider-priority must list at least one provider id" };
  }

  const seen = new Set<ProviderId>();
  const result: ProviderId[] = [];

  for (const token of tokens) {
    const id = VALID_PROVIDER_IDS.find((valid) => valid === token);
    if (id === undefined) {
      return {
        ok: false,
        error: `Invalid provider id "${token}" in --provider-priority. Valid ids: ${VALID_PROVIDER_IDS.join(", ")}`,
      };
    }
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  // Every token is a valid id, so the first one is kept.
  const [first, ...rest] = result;
  if (first === undefined) {
    return { ok: false, error: "--provider-priority must list at least one provider id" };
  }
  return { ok: true, value: [first, ...rest] };
}

export function applyProviderPriorityOverride(
  routing: ModelRouting,
  priority: NonEmptyArray<ProviderId>,
): ModelRouting {
  return { ...routing, providerPriority: priority };
}
