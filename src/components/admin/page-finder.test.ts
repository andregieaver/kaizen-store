import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }) }));

import { shellEn } from "@/lib/admin-messages/shell.en";
import type { FinderGroup } from "@/lib/page-finder";

import { FinderList, finderOptionId } from "./page-finder";

/** The finder's listbox with records (ecosystem plan E2.2, D713): one list of options across the kinds, each kind a named group, and the AI manager last. */

const page = { title: "Orders", group: "Main", what: "Every order", href: "/admin/s/orders" };
const order = { title: "#1001", group: "", what: "Kari · kr 129,50", href: "/admin/s/orders/o1" };
const customer = { title: "Kari Nordmann", group: "", what: "kari@example.com", href: "/admin/s/customers/c1" };
const draw = (groups: FinderGroup[], current: number, ask: string | null) =>
  renderToStaticMarkup(h(FinderList, { listId: "f", groups, current, ask, words: shellEn.finder, onHover: () => {}, onChoose: () => {} }));

describe("the finder's list", () => {
  it("numbers every option in drawing order across the groups, and marks the active one", () => {
    const html = draw([{ kind: "pages", items: [page] }, { kind: "order", items: [order] }, { kind: "customer", items: [customer] }], 2, "kari");
    const ids = [...html.matchAll(/role="option" aria-selected="(true|false)"|id="(f-\d+)"/g)].map((m) => m[2]).filter(Boolean);
    expect(ids).toEqual([finderOptionId("f", 0), finderOptionId("f", 1), finderOptionId("f", 2), finderOptionId("f", 3)]);
    expect(html).toMatch(/id="f-2" role="option" aria-selected="true"/);
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1);
  });

  it("names each kind's group by its heading", () => {
    const html = draw([{ kind: "pages", items: [page] }, { kind: "order", items: [order] }], 0, null);
    expect(html).toContain('id="f-order" role="presentation"');
    expect(html).toContain('role="group" aria-labelledby="f-order"');
    expect(html).toContain(">Orders</div>");
    expect(html).toContain(">Pages</div>");
  });

  it("draws pages alone as before, without headings", () => {
    const html = draw([{ kind: "pages", items: [page] }], 0, null);
    expect(html).not.toContain('role="group"');
    expect(html).toContain('role="listbox" aria-label="Results"');
  });

  it("ends with the AI manager, asked about the words typed, also when nothing matched", () => {
    const html = draw([], 0, "where is 1001");
    expect(html).toMatch(/id="f-0" role="option" aria-selected="true"/);
    expect(html).toContain("Ask the AI manager about “where is 1001”");
    expect(draw([{ kind: "pages", items: [page] }], 0, null)).not.toContain("Ask the AI manager");
  });
});
