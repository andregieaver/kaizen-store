import { describe, expect, it } from "vitest";

import { BROADCAST_TEMPLATE_KEYS, BROADCAST_TEMPLATES, isBroadcastTemplateKey, templateContent, withProducts } from "./broadcast-templates";
import { sendProblems } from "./broadcasts";
import { broadcastContentSchema } from "./broadcasts-schema";
import { findClaims } from "./claims";

/** The templates a broadcast starts from (D368): hand-written in four languages, no claim, and each can be sent as it is. */
describe("broadcast templates", () => {
  it("exist for every key in Norwegian, Swedish, Danish and English, make no claims and can be sent", () => {
    for (const key of BROADCAST_TEMPLATE_KEYS) {
      expect(Object.keys(BROADCAST_TEMPLATES[key]).sort()).toEqual(["da", "en", "nb", "sv"]);
      for (const t of Object.values(BROADCAST_TEMPLATES[key])) {
        for (const text of [t.subject, t.preview, t.heading, t.text, t.button]) expect(findClaims(text), text).toEqual([]);
        expect(t.url.startsWith("/")).toBe(true);
      }
      const content = templateContent(key, ["nb-NO", "en-GB", "de-DE"]);
      expect(Object.keys(content)).toEqual(["nb-NO", "en-GB"]);
      expect(broadcastContentSchema.safeParse(content).success).toBe(true);
      expect(sendProblems(content, "nb-NO")).toEqual([]);
    }
  });

  it("knows its keys", () => {
    expect(BROADCAST_TEMPLATE_KEYS.every(isBroadcastTemplateKey)).toBe(true);
    expect([isBroadcastTemplateKey("x"), isBroadcastTemplateKey(1)]).toEqual([false, false]);
  });
});

describe("withProducts", () => {
  it("puts the products before the button in every language", () => {
    const content = templateContent("new_products", ["nb-NO", "en"]);
    const out = withProducts(content, [{ id: "00000000-0000-4000-8000-000000000001", handle: "lamp", title: "Lamp" }]);
    for (const locale of ["nb-NO", "en"]) {
      const types = out[locale]!.blocks.map((b) => b.type);
      expect(types.indexOf("product")).toBe(types.indexOf("button") - 1);
    }
  });
  it("leaves the words alone without products", () => {
    const content = templateContent("new_products", ["en"]);
    expect(withProducts(content, [])).toBe(content);
  });
});
