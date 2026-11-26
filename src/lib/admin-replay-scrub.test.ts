import { describe, expect, it } from "vitest";

import { scrubAdminEvents } from "./admin-replay-scrub";

/** Admin recordings keep the screen's shape and what the person did, never a word or an address (D895 phase 3b). */
const full = {
  type: 2,
  timestamp: 0,
  data: {
    node: {
      type: 0,
      childNodes: [
        {
          type: 2,
          tagName: "html",
          attributes: { lang: "nb" },
          childNodes: [
            { type: 2, tagName: "style", attributes: {}, childNodes: [{ type: 3, textContent: ".a{color:red}" }] },
            {
              type: 2,
              tagName: "button",
              attributes: { class: "btn", "aria-label": "Refund Kari Nordmann", title: "Kari", "data-email": "kari@example.com", type: "button" },
              childNodes: [{ type: 3, textContent: "Kari Nordmann" }, { type: 3, textContent: "  \n " }],
            },
            { type: 2, tagName: "a", attributes: { href: "/admin/my-shop/orders/123", class: "link" }, childNodes: [] },
            { type: 2, tagName: "input", attributes: { placeholder: "Search customers", value: "Kari", type: "text" }, childNodes: [] },
            { type: 5, textContent: "a comment with a name" },
          ],
        },
      ],
    },
    initialOffset: { left: 0, top: 0 },
  },
};

describe("admin recordings' scrubber", () => {
  it("hides every text and keeps only layout attributes, so no label, tooltip, placeholder or address survives", () => {
    const kept = scrubAdminEvents([full], "s/products")!;
    const text = JSON.stringify(kept);
    for (const word of ["Kari", "Nordmann", "kari@example.com", "Search customers", "my-shop", "orders/123", "comment", "lang"]) expect(text, word).not.toContain(word);
    expect(text).toContain(".a{color:red}");
    expect(text).toContain('"class":"btn"');
    expect(text).toContain('"textContent":"  \\n "');
    expect(text).toContain("•••");
  });

  it("hides text in mutations, what was typed and new nodes' words; keeps a box's tick", () => {
    const kept = scrubAdminEvents(
      [
        {
          type: 3,
          timestamp: 10,
          data: {
            source: 0,
            texts: [{ id: 1, value: "Ola Nordmann" }],
            attributes: [{ id: 2, attributes: { title: "ola@example.com", class: "on" } }],
            adds: [{ parentId: 1, node: { type: 3, textContent: "Order #1001 for Ola" } }],
            removes: [],
          },
        },
        { type: 3, timestamp: 11, data: { source: 5, id: 3, text: "Ola Nordmann", isChecked: true, userTriggered: true } },
      ],
      "s/products",
    )!;
    const text = JSON.stringify(kept);
    for (const word of ["Ola", "Nordmann", "ola@example.com", "1001"]) expect(text, word).not.toContain(word);
    expect(text).toContain('"isChecked":true');
    expect(text).toContain('"class":"on"');
  });

  it("names the screen by its key, refuses a segment that names a screen never measured, and drops other events", () => {
    const kept = scrubAdminEvents(
      [
        { type: 4, timestamp: 0, data: { href: "https://kaizenaflow.com/admin/my-shop/products/abc", width: 1200, height: 800 } },
        { type: 5, timestamp: 1, data: { tag: "kz-page", payload: { path: "s/products/detail" } } },
        { type: 5, timestamp: 2, data: { tag: "kz-click", payload: { dead: true, rage: false, x: 3, y: 4, extra: "Kari" } } },
        { type: 5, timestamp: 3, data: { tag: "other", payload: { name: "Kari" } } },
        { type: 6, timestamp: 4, data: { plugin: "console", payload: { text: "Kari" } } },
      ],
      "s/products/detail",
    )!;
    expect(kept).toEqual([
      { type: 4, timestamp: 0, data: { href: "s/products/detail", width: 1200, height: 800 } },
      { type: 5, timestamp: 1, data: { tag: "kz-page", payload: { path: "s/products/detail" } } },
      { type: 5, timestamp: 2, data: { tag: "kz-click", payload: { dead: true, rage: false, x: 3, y: 4 } } },
    ]);
    expect(scrubAdminEvents([{ type: 5, timestamp: 1, data: { tag: "kz-page", payload: { path: "s/orders" } } }], "s")).toBeNull();
  });
});
