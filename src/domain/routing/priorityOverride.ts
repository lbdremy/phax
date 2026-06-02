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
    const isValid = (VALID_PROVIDER_IDS as readonly string[]).includes(token);
    if (!isValid) {
      return {
        ok: false,
        error: `Invalid provider id "${token}" in --provider-priority. Valid ids: ${VALID_PROVIDER_IDS.join(", ")}`,
      };
    }
    const id = token as ProviderId;
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return { ok: true, value: result as unknown as NonEmptyArray<ProviderId> };
}

export function applyProviderPriorityOverride(
  routing: ModelRouting,
  priority: NonEmptyArray<ProviderId>,
): ModelRouting {
  return { ...routing, providerPriority: priority };
}
