import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { standardCard, type StarterCard } from "@/lib/store-starters";

import { StarterCards } from "./starter-cards";

const spa: StarterCard = {
  id: "0f8fad5b-d9cb-469f-a165-70867728950e",
  title: "Spa & salon",
  summary: "Treatments booked by time, with staff and opening hours.",
  description: "Three treatments, two therapists.\nDeposit at booking.",
  category: "appointments",
  pictureUrl: "/storage/spa.webp",
  previewHref: "/s/spa-template",
};

const draw = (cards: StarterCard[], selected?: string) => renderToString(createElement(StarterCards, { cards, selected }));
/** Whether the radio sending `value` is checked. */
const checked = (html: string, value: string) => {
  const input = (html.match(/<input[^>]*>/g) ?? []).find((tag) => tag.includes(`value="${value}"`));
  return Boolean(input?.includes('checked=""'));
};

describe("the store template cards (D175)", () => {
  it("draws the Standard store first and checked, then each template with its picture, category and summary", () => {
    const html = draw([standardCard("/s/demo"), spa]);
    expect(html.indexOf("Standard store")).toBeLessThan(html.indexOf("Spa &amp; salon"));
    expect(checked(html, "")).toBe(true);
    expect(checked(html, spa.id)).toBe(false);
    expect(html).toContain('src="/storage/spa.webp"');
    expect(html).toContain("Appointments");
    expect(html).toContain("Treatments booked by time");
    expect(html).toContain("More about it");
  });

  it("opens each preview in a new window, without giving the new window this page", () => {
    const html = draw([standardCard("/s/demo"), spa]);
    const links = html.match(/<a [^>]*>/g) ?? [];
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener"');
    }
    expect(html).toContain('href="/s/spa-template"');
    expect(html).toContain("(opens in a new window)");
  });

  it("keeps a chosen template checked, and falls back to the Standard store for an unknown one", () => {
    expect(checked(draw([standardCard(null), spa], spa.id), spa.id)).toBe(true);
    expect(checked(draw([standardCard(null), spa], spa.id), "")).toBe(false);
    expect(checked(draw([standardCard(null), spa], "nope"), "")).toBe(true);
  });

  it("draws no preview link when there is no store to show", () => {
    expect(draw([standardCard(null)])).not.toContain("<a ");
  });
});
