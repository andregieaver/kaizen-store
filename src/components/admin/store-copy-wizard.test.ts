import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { choicesOf, idOf } from "@/lib/store-copy-test-support";
import { addIds, initialWizard, setMode, type WizardState } from "@/lib/store-copy-wizard";

import { StoreCopyWizard } from "./store-copy-wizard";

/** Drawn on the server: what a person sees before any script runs. */
const html = (props: Partial<Parameters<typeof StoreCopyWizard>[0]> = {}) =>
  renderToString(
    createElement(StoreCopyWizard, {
      choices: choicesOf(),
      start: async () => ({ ok: true as const, id: "x" }),
      ...props,
    }),
  )
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'");

const base = (): WizardState => initialWizard("Kaffe & Co");

describe("the duplicate wizard", () => {
  it("opens with the name, All for the lists, and the fixed lists collapsed", () => {
    const out = html();
    expect(out).toContain("The new store");
    expect(out).toContain('value="Copy of Kaffe &amp; Co"');
    expect(out).toContain("Leave empty to make one from the name.");
    for (const title of ["Pages", "Products", "Posts", "People and orders"])
      expect(out).toContain(`>${title}</legend>`);
    expect(out.match(/type="radio"/g)).toHaveLength(9);
    expect(out.match(/name="copy-pages-mode"[^>]*checked=""|checked=""[^>]*name="copy-pages-mode"/g)).toHaveLength(1);
    expect(out).toContain("Always copied");
    expect(out).toContain("Never copied");
    expect(out).toContain("Menus (3)");
    expect(out).toContain("Invoices and their numbering");
    expect(out).toContain("(210)");
    expect(out).toContain("Copies the store's settings, plus all 3 pages, all 40 products and 1 post.");
    expect(out).toContain("Start copy");
    // Nothing to search or confirm yet.
    expect(out).not.toContain("Search products");
    expect(out).not.toContain("I confirm that I may use this customer data");
    expect(out).not.toContain("Not ready to start");
  });

  it("explains honestly what customers and orders are", () => {
    const out = html();
    expect(out).toContain("marketing consents are not copied");
    expect(out).toContain("people who unsubscribed stay unsubscribed");
    expect(out).toContain("Read-only history");
    expect(out).toContain("numbered C-");
    expect(out).toContain("keeps the contact details written on the order");
  });

  it("shows a searchable, counted checklist for Selected", () => {
    let state = setMode(base(), "products", "selected");
    state = addIds(state, "products", [idOf(100), idOf(101)]);
    const out = html({ initial: state });
    expect(out).toContain("Search products");
    expect(out).toContain("2 of 40 selected");
    expect(out).toContain("Select all shown (40)");
    expect(out).toContain("Clear");
    // Long lists are cut to a hundred rows with a way to see more; this one fits.
    expect(out).toContain("Product 1");
    expect(out).toContain('src="https://example.test/one.webp"');
    expect(out).toContain("Draft");
    expect(out).toContain("Copies the store's settings, plus all 3 pages, 2 of 40 products and 1 post.");
  });

  it("cuts a very long list and offers more", () => {
    const products = Array.from({ length: 2500 }, (_, i) => ({
      id: idOf(1000 + i),
      title: `Item ${i}`,
      handle: `item-${i}`,
      status: "active",
      image: null,
    }));
    const out = html({ choices: choicesOf({ products }), initial: setMode(base(), "products", "selected") });
    // A hundred rows, and the two boxes for customers and orders.
    expect(out.match(/type="checkbox"/g)).toHaveLength(102);
    expect(out).toContain("Show 100 more (2,400 left)");
    expect(out).toContain("0 of 2,500 selected");
  });

  it("asks for the confirmation once customers or orders are chosen", () => {
    const state = { ...base(), options: { ...base().options, customers: true } };
    const out = html({ initial: state });
    expect(out).toContain("I confirm that I may use this customer data in the new store.");
    expect(out).toContain("Not ready to start:");
    expect(out).toContain('aria-disabled="true"');
    const sure = html({ initial: { ...state, options: { ...state.options, confirmDataUse: true } } });
    expect(sure).not.toContain("Not ready to start");
    expect(sure).toContain("210 customers");
  });

  it("gives the reason while the choices are not valid", () => {
    const out = html({ initial: { ...base(), name: "" } });
    expect(out).toContain("Not ready to start:");
    expect(out).toContain("Enter a name for the new store.");
    // Errors show inline only after a first try to start.
    expect(out).not.toContain('role="alert"');
    expect(html({ initial: setMode(base(), "pages", "selected") })).toContain(
      "Tick at least one page, or choose All or None.",
    );
  });

  it("shows what the server refused in an alert", () => {
    const out = html({ initialMessages: ["The address nord is taken. Choose another."] });
    expect(out).toContain('role="alert"');
    expect(out).toContain("The copy was not started.");
    expect(out).toContain("The address nord is taken. Choose another.");
  });

  it("shows the inline problems and marks the fields after a failed try", () => {
    const out = html({ initial: { ...base(), name: " " }, initialMessages: [] });
    expect(out).not.toContain('aria-invalid="true"');
    const tried = html({ initial: { ...base(), name: " " }, initialMessages: ["x"] });
    expect(tried).toContain('aria-invalid="true"');
    expect(tried).toContain("copy-name-error");
  });

  it("leaves a kind with nothing to copy without choices, and disables people who are not there", () => {
    const out = html({ choices: choicesOf({ posts: [], customers: 0, orders: 0 }) });
    expect(out).toContain("This store has no posts to copy.");
    expect(out.match(/type="checkbox"[^>]*disabled=""/g)).toHaveLength(2);
  });
});
