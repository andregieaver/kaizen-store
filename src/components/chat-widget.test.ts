import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

import type { ChatProduct } from "@/lib/chat";
import { t } from "@/lib/i18n";
import { unitLabelsOf } from "@/lib/unit-price-text";

import { ProductCard, type ChatLabels } from "./chat-widget";

/** The chat's product card shows the unit price the site works out in code from the price it shows (D160), never the model's. */

const nb = t("nb");
const labels = { vatIncluded: nb.vatIncluded, vatExcluded: nb.vatExcluded, fromPrice: nb.fromPrice, priorPrice: nb.priorPrice, unit: unitLabelsOf(nb) } as ChatLabels;
const card = (price: Partial<ChatProduct["price"]>, from = false) =>
  renderToString(
    createElement(ProductCard, {
      product: {
        id: "p1",
        title: "Kaffe",
        href: "/s/demo/no/p/kaffe",
        image: null,
        from,
        price: { amountMinor: 4990, currency: "NOK", referenceMinor: null, vat: { rate: 0.25, shown: "incl" }, measure: null, ...price },
      } as unknown as ChatProduct,
      locale: "nb-NO",
      labels,
      onOpen: () => undefined,
    }),
  );
const text = (html: string) => html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/[  ]/g, " ").replace(/\s+/g, " ");

describe("the chat's product card", () => {
  it("shows the price per kg under the price, inside the link without a paragraph", () => {
    const html = card({ measure: { amount: "250", unit: "g", base: "kg" } });
    expect(text(html)).toContain("199,60 kr/kg");
    expect(html).not.toContain("<p");
  });

  it("works it from a business-only store's price without VAT", () => {
    expect(text(card({ vat: { rate: 0.25, shown: "excl" }, measure: { amount: "250", unit: "g", base: "kg" } }))).toContain("159,68 kr/kg");
  });

  it("has none without content", () => {
    expect(card({})).not.toContain("data-unit-price");
  });
});
