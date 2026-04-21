import { describe, expect, test } from "bun:test";
import { estimateCostUSD } from "../../src/agent/pricing.ts";

describe("estimateCostUSD", () => {
  test("zero tokens -> zero cost", () => {
    expect(estimateCostUSD("claude-sonnet-4-5", 0, 0)).toBe(0);
  });

  test("sonnet 1M in / 1M out", () => {
    const c = estimateCostUSD("claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(c).toBeCloseTo(18.0, 5);
  });

  test("haiku is cheaper than sonnet", () => {
    const h = estimateCostUSD("claude-haiku-4-5", 1_000_000, 1_000_000);
    const s = estimateCostUSD("claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(h).toBeLessThan(s);
  });

  test("opus is more expensive than sonnet", () => {
    const o = estimateCostUSD("claude-opus-4-5", 1_000_000, 1_000_000);
    const s = estimateCostUSD("claude-sonnet-4-5", 1_000_000, 1_000_000);
    expect(o).toBeGreaterThan(s);
  });

  test("unknown model with 'sonnet' substring uses sonnet rate", () => {
    const a = estimateCostUSD("claude-sonnet-future-9", 1_000_000, 0);
    expect(a).toBeCloseTo(3.0, 5);
  });

  test("unknown model with 'haiku' substring uses haiku rate", () => {
    const a = estimateCostUSD("claude-haiku-future-9", 1_000_000, 0);
    expect(a).toBeCloseTo(1.0, 5);
  });

  test("totally unknown model falls back to default sonnet pricing", () => {
    const a = estimateCostUSD("totally-unknown", 1_000_000, 0);
    expect(a).toBeCloseTo(3.0, 5);
  });
});
