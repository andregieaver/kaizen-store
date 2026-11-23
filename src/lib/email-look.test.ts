import { describe, expect, it } from "vitest";

import { contrast, DEFAULT_EMAIL_LOOK, emailLook } from "./email-look";
import { renderEmail } from "./email-layout";

describe("a marketing email's look from the theme (M4.1)", () => {
  it("takes the theme's accent and its text colour, and the buttons' corners", () => {
    expect(emailLook({ light: { accent: "#1d4ed8", accentText: "#ffffff" }, buttons: { corners: "rounded" } })).toEqual({ accent: "#1d4ed8", onAccent: "#ffffff", radius: "8px" });
    expect(emailLook({ light: { accent: "#000", accentText: "#fff" }, buttons: { corners: "square" } }).radius).toBe("0");
  });

  it("keeps black and white where the colours are faint together, missing or not plain hex", () => {
    expect(emailLook({ light: { accent: "#ffff00", accentText: "#ffffff" }, buttons: { corners: "pill" } })).toEqual(DEFAULT_EMAIL_LOOK);
    expect(emailLook(null)).toEqual(DEFAULT_EMAIL_LOOK);
    expect(emailLook({ light: { accent: "var(--x)", accentText: "#fff" } })).toEqual(DEFAULT_EMAIL_LOOK);
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("draws the email's buttons in the look, and black without one", () => {
    const content = { subject: "Hei", preview: "", blocks: [{ type: "button" as const, text: "Se mer", url: "https://example.com" }], footer: [], lang: "nb" };
    expect(renderEmail({ ...content, look: { accent: "#1d4ed8", onAccent: "#ffffff", radius: "8px" } }).html).toContain("background:#1d4ed8;color:#ffffff");
    expect(renderEmail({ ...content, look: { accent: "#1d4ed8", onAccent: "#ffffff", radius: "8px" } }).html).toContain("border-radius:8px");
    expect(renderEmail(content).html).toContain("background:#171717;color:#ffffff");
  });
});
