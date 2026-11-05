import { describe, expect, it } from "vitest";

import { askFrom } from "./alert-ask";

/**
 * An alert handed to the AI manager (D348, D416): the button beside an alert sends its words at once, the briefing email's link only puts them
 * in the message box for the person to read and send; each press counts, and an ask without words is nothing.
 */
describe("handing an alert to the AI manager", () => {
  it("sends the button's words, counting each press", () => {
    expect(askFrom({ message: "Conversion fell." })).toEqual({ text: "Conversion fell.", n: 1, send: true });
    expect(askFrom({ message: "Conversion fell." }, { n: 1 })).toMatchObject({ n: 2, send: true });
  });

  it("leaves the email link's words in the box, unsent", () => {
    expect(askFrom({ message: "Conversion fell.", send: false })).toEqual({ text: "Conversion fell.", n: 1, send: false });
  });

  it("is nothing without words", () => {
    expect(askFrom(undefined)).toBeNull();
    expect(askFrom({ message: "  " })).toBeNull();
  });
});
