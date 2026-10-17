// Anthropic's API list prices for the Claude models of the catalog, in USD per
// million tokens. They reproduce Claude Code's list-basis `costUSD`, and price
// a cost ledger's partial entries and its rate-limit samples' running cost. A
// copy of Anthropic's published table: it must follow Anthropic's price
// changes. Keyed by Claude catalog id, not by providers.json, so a model a
// user adds there has no price.

/** One model's list price, USD per million tokens. */
export interface ModelListPrice {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
  readonly cacheReadUsdPerMTok: number;
  readonly cacheWrite5mUsdPerMTok: number;
  readonly cacheWrite1hUsdPerMTok: number;
}

function price(
  inputUsdPerMTok: number,
  outputUsdPerMTok: number,
  cacheReadUsdPerMTok: number,
  cacheWrite5mUsdPerMTok: number,
  cacheWrite1hUsdPerMTok: number,
): ModelListPrice {
  return {
    inputUsdPerMTok,
    outputUsdPerMTok,
    cacheReadUsdPerMTok,
    cacheWrite5mUsdPerMTok,
    cacheWrite1hUsdPerMTok,
  };
}

/** Input, output, cache read, cache write 5m, cache write 1h — by Claude catalog id. */
export const CLAUDE_LIST_PRICES: Readonly<Record<string, ModelListPrice>> = {
  "claude-opus-5-5": price(4, 20, 0.2, 5, 8),
  "claude-opus-5": price(5, 25, 0.5, 6.25, 10),
  "claude-opus-4-8": price(5, 25, 0.5, 6.25, 10),
  "claude-opus-4-7": price(5, 25, 0.5, 6.25, 10),
  "claude-opus-4-6": price(5, 25, 0.5, 6.25, 10),
  "claude-sonnet-5-5": price(2, 10, 0.2, 2.5, 4),
  "claude-sonnet-5": price(2, 10, 0.2, 2.5, 4),
  "claude-sonnet-4-6": price(3, 15, 0.3, 3.75, 6),
  "claude-fable-5-1": price(10, 50, 0.25, 12.5, 20),
  "claude-fable-5": price(10, 50, 1, 12.5, 20),
  "claude-haiku-5-5": price(0.1, 0.5, 0.01, 0.125, 0.2),
  "claude-haiku-4-5-20251001": price(1, 5, 0.1, 1.25, 2),
};

const BRACKETED_SUFFIX = /\[[^\]]*\]$/;
const DATE_SUFFIX = /-\d{8}$/;

/**
 * The list price of a model id as a stream names it: a trailing bracketed
 * suffix (`[1m]`) is ignored, then the id matches exactly or, with a trailing
 * `-YYYYMMDD` stripped on both sides, undated. Undefined for any other id.
 */
export function listPriceFor(model: string): ModelListPrice | undefined {
  const id = model.replace(BRACKETED_SUFFIX, "");
  if (Object.hasOwn(CLAUDE_LIST_PRICES, id)) return CLAUDE_LIST_PRICES[id];
  const undated = id.replace(DATE_SUFFIX, "");
  for (const [known, listPrice] of Object.entries(CLAUDE_LIST_PRICES)) {
    if (known.replace(DATE_SUFFIX, "") === undated) return listPrice;
  }
  return undefined;
}
