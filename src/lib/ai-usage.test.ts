import { describe, expect, it } from "vitest";

import { addSums, emptySums, NO_USAGE, readTokens } from "./ai-usage";

describe("the tokens an answer reports (D106, bloat review step 1.19)", () => {
  it("reads the cached input tokens of an OpenAI-compatible answer", () => {
    expect(readTokens({ prompt_tokens: 1000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 800 } })).toEqual({
      inputTokens: 1000,
      outputTokens: 50,
      cachedInputTokens: 800,
    });
  });

  it("reads the cached input tokens of an Anthropic-style answer", () => {
    expect(readTokens({ input_tokens: 1200, output_tokens: 40, cache_read_input_tokens: 900 })).toEqual({ inputTokens: 1200, outputTokens: 40, cachedInputTokens: 900 });
  });

  it("counts 0 cached when neither field is a number", () => {
    expect(readTokens({ prompt_tokens: 300, completion_tokens: 20 })).toEqual({ inputTokens: 300, outputTokens: 20, cachedInputTokens: 0 });
    expect(readTokens({ prompt_tokens: 300, completion_tokens: 20, prompt_tokens_details: { cached_tokens: "many" } })?.cachedInputTokens).toBe(0);
    expect(readTokens({ prompt_tokens: 300, completion_tokens: 20, prompt_tokens_details: null })?.cachedInputTokens).toBe(0);
    expect(readTokens({ total_tokens: 70 })).toEqual({ inputTokens: 70, outputTokens: 0, cachedInputTokens: 0 });
    expect(readTokens(null)).toBeNull();
  });

  it("never counts more cached than input tokens", () => {
    expect(readTokens({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 400 } })?.cachedInputTokens).toBe(100);
    expect(readTokens({ completion_tokens: 5, cache_read_input_tokens: 400 })?.cachedInputTokens).toBe(0);
  });

  it("sums the cached tokens with the rest", () => {
    expect(NO_USAGE.cachedInputTokens).toBe(0);
    const sums = addSums(emptySums(), { ...emptySums(), inputTokens: 10, cachedInputTokens: 4 });
    expect(addSums(sums, { ...emptySums(), inputTokens: 5, cachedInputTokens: 1 })).toMatchObject({ inputTokens: 15, cachedInputTokens: 5 });
  });
});
