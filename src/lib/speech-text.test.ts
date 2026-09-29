import { describe, expect, it } from "vitest";

import { isNoiseTranscript, saysYes, speakable, takeSentences } from "./speech-text";

describe("voice mode's text (D104)", () => {
  it("speaks whole sentences as they arrive and keeps the rest", () => {
    expect(takeSentences("Sales were up this week, by a lot. Orders are wai")).toEqual({
      ready: ["Sales were up this week, by a lot."],
      rest: " Orders are wai",
    });
    // Too short to speak alone: waits for more.
    expect(takeSentences("Yes. Then")).toEqual({ ready: [], rest: "Yes. Then" });
    // A decimal point is not an end.
    expect(takeSentences("The average order was 12.5 euros last week").ready).toEqual([]);
    expect(takeSentences("Short.", true)).toEqual({ ready: ["Short."], rest: "" });
    expect(takeSentences("A first line that is long enough\nand a second").ready).toEqual(["A first line that is long enough"]);
  });

  it("cuts a very long sentence so speech can start", () => {
    const long = `${"word ".repeat(80)}and on`;
    const { ready, rest } = takeSentences(long);
    expect(ready.length).toBeGreaterThan(0);
    expect(ready.every((piece) => piece.length <= 280)).toBe(true);
    expect([...ready, rest].join(" ").replace(/\s+/g, " ").trim()).toBe(long.trim());
  });

  it("leaves out what cannot be said", () => {
    expect(speakable("**Order 1042** is at /admin/kaffe/orders/1042 and https://example.com/x.")).toBe("Order 1042 is at and");
    expect(speakable("- One\n- Two\n1. Three")).toBe("One. Two. Three");
    expect(speakable("See [the page](https://x.test) for 3f2504e0-4f89-41d3-9a0c-0305e82c3301.")).toBe("See the page for .");
  });

  it("drops transcripts of noise", () => {
    expect(isNoiseTranscript("Thank you.")).toBe(true);
    expect(isNoiseTranscript("you you you you")).toBe(true);
    expect(isNoiseTranscript("Undertekster av Amara.org")).toBe(true);
    expect(isNoiseTranscript("Thank you, what sold best this week?")).toBe(false);
  });

  it("hears a plain yes, in several languages, and not a hedged one", () => {
    for (const yes of ["Yes, do it", "ok", "Ja, gjør det", "Japp", "Godkänn", "go ahead please"]) expect(saysYes(yes), yes).toBe(true);
    for (const no of ["No", "Yes, but don't send it yet", "Nei, ikke ennå", "wait", "What is it?", "Yesterday's orders"]) expect(saysYes(no), no).toBe(false);
  });
});
