import { describe, expect, it } from "vitest";

import { aiFormValues, aiProviderInput, apiBaseUrl, checkBaseUrl, embeddingSpace, keyHint } from "./ai-provider";
import { cosineSimilarity } from "./vectors";

const valid = {
  provider: "gateway",
  baseUrl: "",
  apiKey: "vck_secret",
  embeddingModel: "mistral/mistral-embed",
  textModel: "",
  minSimilarity: "0.8",
  embeddingEuOnly: false,
  textEuOnly: true,
  zeroDataRetention: true,
  enabled: true,
};

describe("AI providers (D73)", () => {
  it("takes public https addresses only, for providers of the store's own", () => {
    expect(checkBaseUrl("https://api.example.com/v1/")).toEqual({ ok: true, url: "https://api.example.com/v1" });
    for (const bad of [
      "http://api.example.com/v1",
      "https://127.0.0.1/v1",
      "https://[::1]/v1",
      "https://localhost/v1",
      "https://metadata.internal/v1",
      "https://intranet/v1",
      "https://user:pw@api.example.com/v1",
      "https://api.example.com:8443/v1",
      "https://api.example.com/v1?key=1",
      "not a url",
    ]) {
      expect(checkBaseUrl(bad).ok, bad).toBe(false);
    }
  });

  it("knows the known providers' addresses, and names each model's vectors apart", () => {
    expect(apiBaseUrl("gateway", null)).toBe("https://ai-gateway.vercel.sh/v1");
    expect(apiBaseUrl("custom", "https://llm.example.com/v1")).toBe("https://llm.example.com/v1");
    expect(embeddingSpace("gateway", null, "mistral/mistral-embed")).toBe("ai-gateway.vercel.sh/v1|mistral/mistral-embed");
    expect(embeddingSpace("gateway", null, "openai/text-embedding-3-small")).not.toBe(
      embeddingSpace("gateway", null, "mistral/mistral-embed"),
    );
    expect(keyHint(" sk-abcdef1234 ")).toBe("…1234");
  });

  it("checks the settings form", () => {
    expect(aiProviderInput.parse(valid)).toMatchObject({ embeddingModel: "mistral/mistral-embed", textModel: null, minSimilarity: 0.8 });
    const problems = (input: Record<string, unknown>) => {
      const result = aiProviderInput.safeParse({ ...valid, ...input });
      return result.success ? [] : result.error.issues.map((issue) => issue.message);
    };
    expect(problems({ provider: "acme" })).toEqual(["Choose a provider."]);
    expect(problems({ embeddingModel: "", textModel: "" })).toEqual(["Name at least one model."]);
    expect(problems({ embeddingModel: "mistral embed; drop" })[0]).toMatch(/letters, digits/);
    expect(problems({ minSimilarity: "1.5" })).toEqual(["The similarity is a number from 0 to 1."]);
    expect(problems({ provider: "custom", baseUrl: "http://10.0.0.1/v1" })).toEqual(["The address must start with https://."]);
    expect(problems({ provider: "custom", baseUrl: "https://llm.example.com/v1" })).toEqual([]);
  });

  it("reads checkboxes from the form as on or off", () => {
    const form = new FormData();
    form.set("provider", "mistral");
    form.set("embeddingModel", "mistral-embed");
    form.set("textEuOnly", "on");
    expect(aiFormValues(form)).toMatchObject({ provider: "mistral", embeddingEuOnly: false, textEuOnly: true, enabled: false, minSimilarity: "0.8" });
  });

  it("measures how alike two vectors are", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([1, 2], [-1, -2])).toBeCloseTo(-1);
    expect(cosineSimilarity([1, 2], [1])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0);
  });
});
