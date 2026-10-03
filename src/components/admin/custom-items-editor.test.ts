import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { newCustomItem, newDetailLine } from "@/lib/custom-grid";
import { newBlock } from "@/lib/page-rows";
import type { ContentGridBlock } from "@/lib/page-content";

import { CopyCurrentItems, CustomItemsEditor, itemName } from "./custom-items-editor";

vi.mock("server-only", () => ({}));

/** The builder's editor for custom grid items (D155), as the server draws it before it runs: the fields of an item and what it says beside them. */

const html = (element: Parameters<typeof renderToString>[0]) => renderToString(element).replace(/<!-- -->/g, "");
const editor = (items = [newCustomItem("a"), newCustomItem("b")]) =>
  html(createElement(CustomItemsEditor, { items, onChange: () => {}, upload: async () => ({ ok: true as const, url: "https://x/y.webp" }), linkTargets: async () => ({ kinds: [], targets: {} }) }));

describe("the editor of a grid's custom items", () => {
  it("lists the items by title, folds all but the first, and offers to add, move, duplicate and remove", () => {
    const out = editor([{ ...newCustomItem("a"), title: "Fjordtur", text: "Words" }, newCustomItem("b")]);
    expect(out).toContain("Fjordtur");
    expect(out).toContain("Item 2 (nothing to show yet)");
    expect(out).toContain("Add an item");
    expect(out).toContain('aria-label="Duplicate Fjordtur"');
    expect(out).toContain('aria-label="Move Fjordtur down"');
    expect(out).toContain('aria-label="Remove Fjordtur"');
    expect(out).toContain('aria-expanded="true"');
    expect(out).toContain('aria-expanded="false"');
  });

  it("has every field of an item, and says a price text is not a live price", () => {
    const out = editor();
    for (const label of ["Picture", "Title", "Text", "Link to", "Button text", "Date", "Badge", "Price text", "Detail lines", "Add a detail line"]) {
      expect(out, label).toContain(label);
    }
    expect(out).toContain("Not a live price: shoppers pay what the checkout charges.");
    // The picture's alt text comes with a picture, and an empty one is decoration.
    const withPicture = editor([{ ...newCustomItem("a"), picture: { url: "https://x/y.webp", width: 1, height: 1, alt: "" } }]);
    expect(withPicture).toContain("Describe the picture");
    expect(withPicture).toContain("Leave empty if the picture is only decoration");
    expect(out).not.toContain("Describe the picture");
  });

  it("lets an item be dragged by a handle of its own, besides the arrows, and says what custom items do not do", () => {
    const out = editor([{ ...newCustomItem("a"), title: "Fjordtur" }, newCustomItem("b")]);
    // A handle (a button, so a keyboard moves it too) on every item.
    expect(out.match(/aria-roledescription="sortable"/g)).toHaveLength(2);
    expect(out).toContain('aria-label="Drag Fjordtur to move it"');
    expect(out).toContain("drag an item by its handle");
    // What is not included is said under the list, so nobody looks for a hero slider.
    expect(out).toContain("Not included:");
    expect(out).toContain("hero slider");
    expect(out).toContain("vertical or fading sliders");
  });

  it("gives each detail line an id of its own and keys it by that", () => {
    const item = { ...newCustomItem("a"), details: [newDetailLine("x1"), newDetailLine("x2")] };
    const out = editor([item]);
    expect(out).toContain("Label 1");
    expect(out).toContain("Label 2");
    expect(new Set(item.details.map((line) => line.id)).size).toBe(2);
  });

  it("limits each text as the schema does", () => {
    const out = editor();
    for (const max of ["200", "600", "60", "40"]) expect(out).toContain(`maxLength="${max}"`);
  });

  it("names an item by its title, else by its place", () => {
    expect(itemName({ ...newCustomItem("a"), title: " Tur " }, 0)).toBe("Tur");
    expect(itemName(newCustomItem("a"), 2)).toBe("Item 3 (nothing to show yet)");
    expect(itemName({ ...newCustomItem("a"), text: "x" }, 0)).toBe("Item 1");
  });

  it("offers to copy what a grid shows now, and says prices are left out", () => {
    const block = newBlock("contentGrid", () => "g") as ContentGridBlock;
    const out = html(createElement(CopyCurrentItems, { block, platform: false, load: async () => ({ problem: "x" }), onCopied: () => {} }));
    expect(out).toContain("Copy current items");
    expect(out).toContain("Prices are left");
  });
});
