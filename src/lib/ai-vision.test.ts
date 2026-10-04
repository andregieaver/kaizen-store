import { describe, expect, it } from "vitest";

import { AI_PROVIDERS, aiProviderInput } from "./ai-provider";
import { pictureLine, suggestedVision, visionAnswerRight, visionChallenge, visionModelOf, visionRefusalMessage } from "./ai-vision";

describe("the picture check", () => {
  it("draws two different colours, whatever the dice say", () => {
    for (let i = 0; i < 40; i++) {
      const c = visionChallenge();
      expect(c.top).not.toBe(c.bottom);
    }
    expect(visionChallenge(() => 0)).toEqual({ top: "red", bottom: "green" });
    expect(visionChallenge(() => 0.999)).toEqual({ top: "yellow", bottom: "blue" });
  });

  it("reaches every ordered pair of different colours: twelve, so a guess is right one time in twelve", () => {
    const pairs = new Set<string>();
    const picks = [0, 0.26, 0.51, 0.76];
    for (const first of picks) {
      for (const second of picks) {
        const queue = [first, second];
        const c = visionChallenge(() => queue.shift() ?? 0);
        pairs.add(`${c.top}>${c.bottom}`);
      }
    }
    expect(pairs.size).toBe(12);
  });

  it("accepts the two colours in order, in any wording or case", () => {
    const c = { top: "red", bottom: "blue" } as const;
    expect(visionAnswerRight("red, blue", c)).toBe(true);
    expect(visionAnswerRight("Top: Red. Bottom: BLUE.", c)).toBe(true);
    expect(visionAnswerRight("The top band is red and the bottom band is blue.", c)).toBe(true);
  });

  it("refuses the wrong colours, the wrong order, one colour and no colour", () => {
    const c = { top: "red", bottom: "blue" } as const;
    expect(visionAnswerRight("blue, red", c)).toBe(false);
    expect(visionAnswerRight("red, green", c)).toBe(false);
    expect(visionAnswerRight("red", c)).toBe(false);
    expect(visionAnswerRight("I cannot see any picture.", c)).toBe(false);
    expect(visionAnswerRight("purple, orange", c)).toBe(false);
  });

  it("tells a refusal of a picture from a failure to answer", () => {
    expect(visionRefusalMessage("gpt-x", 400)).toMatch(/cannot look at pictures/);
    expect(visionRefusalMessage("gpt-x", 500)).toMatch(/did not answer \(error 500\)/);
    expect(visionRefusalMessage("gpt-x", undefined)).toMatch(/no answer/);
  });
});

describe("which model looks at pictures", () => {
  it("is the vision model, else the text model, else none", () => {
    expect(visionModelOf({ visionModel: "v", textModel: "t" })).toBe("v");
    expect(visionModelOf({ visionModel: null, textModel: "t" })).toBe("t");
    expect(visionModelOf({ visionModel: null, textModel: null })).toBeNull();
  });

  it("says in one line what the site does about pictures", () => {
    expect(pictureLine({ enabled: true, visionModel: "claude", textModel: "haiku" }, "Kaizen's AI")).toBe("Kaizen's AI looks at pictures with claude.");
    expect(pictureLine({ enabled: true, visionModel: null, textModel: "haiku" }, "Your AI")).toMatch(/with haiku \(the text model: check/);
    expect(pictureLine({ enabled: false, visionModel: "claude", textModel: null }, "Your AI")).toMatch(/no model that looks at pictures/);
    expect(pictureLine(null, "Kaizen's AI", "Use your own AI below to choose one.")).toMatch(/Use your own AI below/);
  });

  it("offers a suggestion for every provider that has models, each with a note", () => {
    for (const p of AI_PROVIDERS) {
      for (const s of p.visionModels) expect(s.note.length).toBeGreaterThan(0);
      expect(new Set(p.visionModels.map((s) => s.model)).size).toBe(p.visionModels.length);
    }
    const gateway = AI_PROVIDERS.find((p) => p.id === "gateway")!;
    expect(suggestedVision(gateway.visionModels, "anthropic/claude-sonnet-5")?.note).toBeTruthy();
    expect(suggestedVision(gateway.visionModels, "nonsense")).toBeNull();
    expect(suggestedVision(gateway.visionModels, null)).toBeNull();
  });
});

describe("the vision model in the settings form", () => {
  const base = { provider: "openai", apiKey: "k", embeddingModel: "", textModel: "gpt-5-mini", minSimilarity: 0.3, embeddingEuOnly: false, textEuOnly: false, zeroDataRetention: false, enabled: true };
  it("is optional, and empty means none", () => {
    expect(aiProviderInput.parse(base).visionModel).toBeNull();
    expect(aiProviderInput.parse({ ...base, visionModel: "  gpt-4.1-mini " }).visionModel).toBe("gpt-4.1-mini");
  });
  it("refuses a name with odd characters", () => {
    expect(aiProviderInput.safeParse({ ...base, visionModel: "bad name!" }).success).toBe(false);
  });
});
