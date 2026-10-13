import { describe, expect, it } from "vitest";

import { bandOf, crossedLine, parseTone, rollingTone, TONE_BANDS, TONE_BAND_WORDS, TONE_WEIGHTS, toneFell, toneHistory, tonePrompt } from "./support-tone";

describe("a customer's tone (D216, 2.6)", () => {
  it("puts a score in one of five bands, each with its words", () => {
    expect([-100, -60, -59, -20, -19, 0, 19, 20, 59, 60, 100].map(bandOf)).toEqual([
      "very_bad",
      "very_bad",
      "bad",
      "bad",
      "neutral",
      "neutral",
      "neutral",
      "good",
      "good",
      "very_good",
      "very_good",
    ]);
    expect(TONE_BANDS.every((band) => TONE_BAND_WORDS[band].length > 0)).toBe(true);
  });

  it("rolls the last six scores up, newest weighing most, unscored ones left out", () => {
    expect(TONE_WEIGHTS).toEqual([1, 1, 2, 3, 5, 8]);
    expect(rollingTone([])).toBeNull();
    expect(rollingTone([null, null])).toBeNull();
    expect(rollingTone([40])).toBe(40);
    // Two scores take the last two weights: (5·0 + 8·−80) / 13.
    expect(rollingTone([0, null, -80])).toBe(Math.round(-640 / 13));
    // Only the last six count.
    expect(rollingTone([100, 100, 0, 0, 0, 0, 0, 0])).toBe(0);
  });

  it("alerts when the tone crosses the desk's line, or falls 40 within three messages", () => {
    expect(toneFell([], -40)).toBe(false);
    expect(toneFell([-45], -40)).toBe(true);
    expect(toneFell([10, -41], -40)).toBe(true);
    // Already under the line: not again.
    expect(toneFell([-41, -50], -40)).toBe(false);
    expect(toneFell([50, 30, 10], null)).toBe(true);
    expect(toneFell([50, 30, 20], null)).toBe(false);
    expect(toneFell([60, 0, 0, 0, 25], null)).toBe(false);
  });

  it("reads a model's answer only when it holds a whole score and a known label", () => {
    expect(parseTone('Here: {"score": -55, "label": "frustrated"}')).toEqual({ score: -55, label: "frustrated" });
    expect(parseTone('{"score": 140, "label": "happy"}')).toBeNull();
    expect(parseTone('{"score": 2.5, "label": "happy"}')).toBeNull();
    expect(parseTone('{"score": 10, "label": "ecstatic"}')).toBeNull();
    expect(parseTone("I would say quite angry")).toBeNull();
  });

  it("keeps the rolling value after each scored message, leaving unscored ones out", () => {
    expect(toneHistory([])).toEqual([]);
    expect(toneHistory([null, 40, null, -80])).toEqual([40, Math.round((5 * 40 + 8 * -80) / 13)]);
  });

  it("hands over once, when the tone just reaches the line", () => {
    expect(crossedLine([-70], -60)).toBe(true);
    expect(crossedLine([10, -60], -60)).toBe(true);
    expect(crossedLine([-61, -70], -60)).toBe(false);
    expect(crossedLine([-70], null)).toBe(false);
    expect(crossedLine([], -60)).toBe(false);
  });

  it("gives the model the last lines by role, the scored one last, on one line each", () => {
    expect(tonePrompt([
      { author: "ai", body: "Hello!" },
      { author: "customer", body: "Where is\nmy parcel?" },
    ])).toBe("Assistant: Hello!\nCustomer: Where is my parcel?\n\nRate the last customer message.");
  });
});
