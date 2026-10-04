import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AiProviderForm, type AiFormSettings } from "./ai-provider-form";

vi.mock("server-only", () => ({}));

const action = async () => ({ status: "idle" as const, messages: [] });
const render = (settings: AiFormSettings | null, checkVision?: () => Promise<never>) =>
  renderToString(createElement(AiProviderForm, { action, settings, ...(checkVision ? { checkVision } : {}) }));

const saved = (patch: Partial<AiFormSettings> = {}): AiFormSettings => ({
  provider: "gateway",
  baseUrl: null,
  apiKeyHint: "…1111",
  embeddingModel: null,
  textModel: "anthropic/claude-haiku-4.5",
  visionModel: null,
  transcriptionModel: null,
  speechModel: null,
  speechVoice: null,
  imageModel: null,
  imageProvider: null,
  imageBaseUrl: null,
  imageApiKeyHint: null,
  imageQuality: null,
  liveModel: null,
  liveVoice: null,
  liveProvider: null,
  liveBaseUrl: null,
  liveApiKeyHint: null,
  minSimilarity: 0.3,
  embeddingEuOnly: false,
  textEuOnly: false,
  zeroDataRetention: false,
  enabled: true,
  ...patch,
});

describe("the model that sees pictures, in the AI settings form (D163)", () => {
  it("is its own field, named for what it does, reachable by #vision", () => {
    const html = render(saved());
    expect(html).toMatch(/id="vision"/);
    expect(html).toContain("Model that sees pictures");
    expect(html).toContain('name="visionModel"');
    expect(html).toContain("copying another site&#x27;s page");
  });

  it("offers the provider's models that see pictures, each with what it is good for, as one press each", () => {
    const html = render(saved());
    expect(html).toContain("anthropic/claude-sonnet-5");
    expect(html).toContain("Most careful, for copying pages");
    expect(html).toContain("google/gemini-2.5-flash");
    expect(html).toMatch(/aria-pressed="false"/);
  });

  it("shows the saved vision model as chosen", () => {
    const html = render(saved({ visionModel: "anthropic/claude-sonnet-5" }));
    expect(html).toContain('value="anthropic/claude-sonnet-5"');
    expect(html).toMatch(/aria-pressed="true"/);
  });

  it("has the check only when a check is given, and says what it does and costs", () => {
    expect(render(saved())).not.toContain("Check that it sees pictures");
    const html = render(saved(), async () => ({}) as never);
    expect(html).toContain("Check that it sees pictures");
    expect(html).toContain("what colours are in it");
    expect(html).toContain("costs almost nothing");
  });

  it("has no suggestions for a provider of your own, but still the field", () => {
    const html = render(saved({ provider: "custom", baseUrl: "https://api.example.com/v1", textModel: "m" }));
    expect(html).toContain('name="visionModel"');
    expect(html).not.toContain("Models that usually see pictures");
  });
});
