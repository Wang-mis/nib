// Pricing — rough USD estimates per 1M tokens for cost cap enforcement.
// Source: Anthropic public pricing as of 2026-04. Values are intentionally
// approximate; the cap is a safety rail, not an accountant.
const PRICING_PER_M_TOKENS: Readonly<
  Record<string, { input: number; output: number }>
> = Object.freeze({
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-opus-4-5": { input: 15.0, output: 75.0 },
});

const FALLBACK = Object.freeze({ input: 3.0, output: 15.0 });

export function estimateCostUSD(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const rate = PRICING_PER_M_TOKENS[model] ?? matchPrefix(model) ?? FALLBACK;
  return (
    (inputTokens / 1_000_000) * rate.input + (outputTokens / 1_000_000) * rate.output
  );
}

function matchPrefix(model: string): { input: number; output: number } | undefined {
  for (const [key, value] of Object.entries(PRICING_PER_M_TOKENS)) {
    if (model.startsWith(key)) return value;
  }
  if (model.includes("haiku")) return PRICING_PER_M_TOKENS["claude-haiku-4-5"];
  if (model.includes("opus")) return PRICING_PER_M_TOKENS["claude-opus-4-5"];
  if (model.includes("sonnet")) return PRICING_PER_M_TOKENS["claude-sonnet-4-5"];
  return undefined;
}
