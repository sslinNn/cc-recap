// List prices, USD per million tokens. Override with --prices path/to/prices.json.
export const DEFAULT_PRICES = {
  "claude-opus-5": { in: 15, out: 75 },
  "claude-sonnet-5": { in: 3, out: 15 },
  "claude-haiku-4-5": { in: 1, out: 5 },
};

// Cache multipliers applied to the input price.
export const CACHE_READ = 0.1;
export const CACHE_WRITE_5M = 1.25;
export const CACHE_WRITE_1H = 2.0;

const FALLBACK = [
  [/opus/i, { in: 15, out: 75 }],
  [/sonnet/i, { in: 3, out: 15 }],
  [/haiku/i, { in: 1, out: 5 }],
];

export function priceFor(model, prices = DEFAULT_PRICES) {
  if (prices[model]) return prices[model];
  const key = Object.keys(prices).find((k) => model.startsWith(k));
  if (key) return prices[key];
  const hit = FALLBACK.find(([re]) => re.test(model));
  return hit ? hit[1] : { in: 0, out: 0 };
}

export function modelLabel(model) {
  if (/opus-5/.test(model)) return "Opus 5";
  if (/sonnet-5/.test(model)) return "Sonnet 5";
  if (/haiku-4-5/.test(model)) return "Haiku 4.5";
  return model.replace(/^claude-/, "");
}

/** What a turn was billed, and what the same tokens would have cost with no cache at all. */
export function costOf(turn, prices = DEFAULT_PRICES) {
  const { in: pin, out: pout } = priceFor(turn.model, prices);
  const per = pin / 1e6;
  // The split fields are authoritative; older records only carry the total, which we price at 5m.
  const split = turn.cacheWrite1h + turn.cacheWrite5m;
  const write1h = split ? turn.cacheWrite1h : 0;
  const write5m = split ? turn.cacheWrite5m : turn.cacheWrite;

  const billed =
    turn.input * per +
    turn.cacheRead * per * CACHE_READ +
    write1h * per * CACHE_WRITE_1H +
    write5m * per * CACHE_WRITE_5M +
    (turn.output * pout) / 1e6;

  const uncached =
    (turn.input + turn.cacheRead + turn.cacheWrite) * per + (turn.output * pout) / 1e6;

  return { billed, uncached };
}
