import { describe, expect, it } from "vitest";

import { contrast, DEFAULT_EMAIL_LOOK, emailLook } from "./email-look";
import { renderEmail } from "./email-layout";

describe("a marketing email's look from the theme (M4.1)", () => {
  const theme = {
    light: { accent: "#14532d", accentText: "#ffffff", background: "#fffdf7", surface: "#f3efe4", text: "#1c1917", muted: "#57534e", border: "#e7e0cf" },
    buttons: { corners: "square" },
    corners: { cards: "none" },
    headings: { weight: "semibold", case: "upper" },
    fonts: { heading: "Playfair Display", body: "Inter" },
  };

  it("takes the theme's page, card, words and lines, its headings and its fonts, with the system's fonts after them", () => {
    const look = emailLook(theme);
    expect(look).toMatchObject({ page: "#f3efe4", card: "#fffdf7", text: "#1c1917", muted: "#57534e", footer: "#57534e", border: "#e7e0cf", cardRadius: "0", headingWeight: 600, headingUpper: true });
    expect(look.headingFont.startsWith("'Playfair Display', -apple-system")).toBe(true);
    expect(look.bodyFont.startsWith("'Inter', ")).toBe(true);
    const html = renderEmail({ subject: "s", preview: "", blocks: [{ type: "heading", text: "Høst" }], footer: ["Butikken"], lang: "nb", look }).html;
    expect(html).toContain("background:#f3efe4");
    expect(html).toContain("background:#fffdf7;border-radius:0");
    expect(html).toContain("color:#1c1917;font-family:'Playfair Display'");
    expect(html).toContain("text-transform:uppercase");
  });

  it("keeps the defaults for words that could not be read, and a font name that is not one", () => {
    const faint = emailLook({ ...theme, light: { ...theme.light, text: "#f5f5f5", muted: "#eeeeee" }, fonts: { heading: "x'; color:red", body: undefined } });
    expect(faint).toMatchObject({ card: DEFAULT_EMAIL_LOOK.card, text: DEFAULT_EMAIL_LOOK.text, muted: DEFAULT_EMAIL_LOOK.muted });
    expect(faint.headingFont).toBe(DEFAULT_EMAIL_LOOK.headingFont);
    // Without a look an email is drawn as before.
    const plain = renderEmail({ subject: "s", preview: "", blocks: [{ type: "heading", text: "Hei" }], footer: [], lang: "nb" }).html;
    expect(plain).toContain('background:#f5f5f4');
    expect(plain).toContain("color:#171717;font-family:-apple-system");
    expect(plain).toContain("font-weight:700");
  });

  it("takes the theme's accent and its text colour, and the buttons' corners", () => {
    expect(emailLook({ light: { accent: "#1d4ed8", accentText: "#ffffff" }, buttons: { corners: "rounded" } })).toMatchObject({ accent: "#1d4ed8", onAccent: "#ffffff", radius: "8px" });
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
