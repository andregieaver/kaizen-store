import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { pageBlockSchema, type CardItem, type CardsBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

import { CardsFilter } from "./cards-filter";
import { CardsView } from "./cards-view";

/**
 * Cards (D916): each card with its marker, small line, title, badge, words, points and link, in the block's columns; filter chips only
 * with more than one group; and the content's rules.
 */

const card = (patch: Partial<CardItem> = {}): CardItem => ({
  id: `c${Math.random().toString(36).slice(2, 8)}`,
  eyebrow: "",
  title: "A title",
  text: "",
  points: [],
  badge: "",
  group: "",
  linkLabel: "",
  href: "",
  ...patch,
});
const block = (patch: Partial<CardsBlock> = {}): CardsBlock => ({ id: "b", type: "cards", marker: "icon", columns: 3, items: [card({ icon: "bot" })], ...patch });
const draw = (b: CardsBlock) => renderToString(createElement(CardsView, { block: b }));

describe("cards on the site (D916)", () => {
  it("draws each card with its icon, small line, title, words and points, in the block's columns", () => {
    const html = draw(
      block({
        items: [card({ icon: "bot", eyebrow: "Assistant", title: "An assistant that acts", text: "It does things.", points: [{ id: "p1", text: "Triage email" }] })],
      }),
    );
    expect(html).toContain("md:grid-cols-2 lg:grid-cols-3");
    expect(html).toContain("Assistant");
    expect(html).toContain("An assistant that acts");
    expect(html).toContain("It does things.");
    expect(html).toContain("Triage email");
    expect(html).toContain("<svg");
  });

  it("numbers the cards, writes letters on their colour, and draws a round picture with its description", () => {
    expect(draw(block({ marker: "number", items: [card(), card()] }))).toMatch(/>1<[\s\S]*>2</);
    expect(draw(block({ marker: "letter", items: [card({ letters: "G", color: "#4285f4" })] }))).toContain("background:#4285f4");
    const picture = draw(block({ marker: "picture", items: [card({ title: "Nora", picture: { url: "https://example.com/a.webp", width: 400, height: 400, alt: "" } })] }));
    expect(picture).toContain('alt="Nora"');
    expect(picture).toContain("rounded-full");
  });

  it("shows a badge in its tone and a link with its words", () => {
    const html = draw(block({ items: [card({ badge: "Live", badgeTone: "success", href: "/plans", linkLabel: "Explore" })] }));
    expect(html).toContain("Live");
    expect(html).toContain("#22a04b");
    expect(html).toContain('href="/plans"');
    expect(html).toContain("Explore");
  });

  it("leaves out a card with nothing written, and draws nothing without cards", () => {
    expect(draw(block({ items: [card({ title: "" })] }))).toBe("");
    expect(draw(block({ items: [card({ title: "Kept" }), card({ title: "" })] })).match(/<li/g)).toHaveLength(1);
  });

  it("keeps every card in the page, marked with its group, for the chips loaded later", () => {
    const html = draw(block({ filters: true, allLabel: "All", items: [card({ group: "Health" }), card({ group: "Social" }), card({ group: "Health" })] }));
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html.match(/data-group="Health"/g)).toHaveLength(2);
  });

  it("offers All and each group with its count as chips", () => {
    const html = renderToString(
      createElement(CardsFilter, { list: "cards-b", all: "Alle", total: 3, groups: [{ name: "Health", count: 2 }, { name: "Social", count: 1 }] }),
    );
    expect(html).toContain('aria-controls="cards-b"');
    expect(html.match(/aria-pressed/g)).toHaveLength(3);
    expect(html).toMatch(/Alle[\s\S]*3[\s\S]*Health[\s\S]*2[\s\S]*Social[\s\S]*1/);
  });
});

describe("the cards' content (D916)", () => {
  it("is made with three cards to write in, and holds to its rules", () => {
    let n = 0;
    const made = newBlock("cards", () => `id${++n}`) as CardsBlock;
    expect(made.items).toHaveLength(3);
    expect(pageBlockSchema.safeParse(made).success).toBe(true);
    expect(pageBlockSchema.safeParse({ ...made, columns: 5 }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...made, items: [{ ...made.items[0], href: "javascript:alert(1)" }] }).success).toBe(false);
    expect(pageBlockSchema.safeParse({ ...made, items: [{ ...made.items[0], letters: "ABCD" }] }).success).toBe(false);
  });
});
