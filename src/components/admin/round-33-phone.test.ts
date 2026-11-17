import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { adminTexts } from "@/lib/admin-text";
import type { PageSummary } from "@/server/pages";

import { AdminTextScope } from "./admin-text";
import { PageCards } from "./page-cards";
import { PHONE_MORE_HIDDEN } from "./phone-more-class";
import { AddEndpoint } from "./webhook-endpoints";

/** Round 33 (D707): the Pages list and the add-endpoint form on a phone. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "").replace(/&#x27;/g, "'");
const scoped = (child: unknown, props: object, areas: Parameters<typeof adminTexts>[1]) =>
  createElement(AdminTextScope, { texts: adminTexts("en", areas), children: createElement(child as never, props as never) });

const page = (n: number, over: Partial<PageSummary> = {}): PageSummary => ({
  id: `p${n}`,
  title: `Page ${n}`,
  slug: `page-${n}`,
  state: "published",
  updatedAt: "2026-11-16T10:00:00.000Z",
  publishedAt: "2026-11-16T10:00:00.000Z",
  searchEngines: true,
  aiAssistants: true,
  thumbnail: null,
  ...over,
});

describe("the Pages list on a phone (round 33, D707)", () => {
  it("shows the first ten pages and keeps back the rest behind Show all", () => {
    const out = html(scoped(PageCards, { pages: Array.from({ length: 13 }, (_, n) => page(n)), adminBase: "/admin/s/pages", siteBase: "https://s.example" }, ["website"]));
    expect(out).toContain("Show all 13");
    expect(out.split(PHONE_MORE_HIDDEN).length - 1).toBe(3);
  });

  it("says a page's state, its place and its day as one line, and draws no empty square for a page without a picture", () => {
    const out = html(scoped(PageCards, { pages: [page(1, { state: "changed" })], adminBase: "/admin/s/pages", siteBase: "https://s.example", frontPageId: "p1" }, ["website"]));
    expect(out).toMatch(/Published, draft has changes · Front page · 16 Nov/);
    expect(out).toContain("max-sm:hidden");
    expect(out).not.toContain("Show all");
  });
});

describe("adding an endpoint on a phone (round 33, D707)", () => {
  it("says how many events are chosen and which, in one row that opens to the list", () => {
    const topics = [
      { id: "order.paid", label: "Order paid", hint: "" },
      { id: "order.sent", label: "Order sent", hint: "" },
      { id: "product.created", label: "Product created", hint: "" },
    ];
    const out = html(scoped(AddEndpoint, { topics, defaults: ["order.paid", "order.sent"], add: async () => ({ ok: true }) }, ["notifications"]));
    expect(out).toContain("2 of 3: Order paid, Order sent");
    expect(out.match(/type="checkbox"/g)).toHaveLength(3);
  });
});
