import { describe, expect, it } from "vitest";

import { builderInput, emptyAddress, type BuilderForm } from "./exchange-form";

const address = { name: "Kari Nordmann", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "no", phone: "" };
const line = { variantId: "77777777-7777-4777-8777-777777777777", title: "Blue mug", sku: "MUG-BLUE", options: "", listPriceMinor: 15_000, quantity: "2", price: "" };
const form = (over: Partial<BuilderForm> = {}): BuilderForm => ({ lines: [line], shipping: "free", shippingPrice: "", address, ...over });

describe("the exchange builder's input", () => {
  it("takes the list price when no price is typed, and uppercases the country", () => {
    const { raw, problems } = builderInput(form(), "NOK");
    expect(problems).toEqual([]);
    expect(raw.lines).toEqual([{ variantId: line.variantId, quantity: 2, unitPriceMinor: 15_000 }]);
    expect(raw.shipping).toEqual({ kind: "free" });
    expect(raw.deliveryAddress.country).toBe("NO");
    expect(raw.deliveryAddress.phone).toBeNull();
  });

  it("reads a lowered price in the order's currency, and refuses a raised one", () => {
    expect(builderInput(form({ lines: [{ ...line, price: "120,50" }] }), "NOK").raw.lines[0].unitPriceMinor).toBe(12_050);
    expect(builderInput(form({ lines: [{ ...line, price: "160" }] }), "NOK").problems.join(" ")).toMatch(/never raised/);
    expect(builderInput(form({ lines: [{ ...line, price: "abc" }] }), "NOK").problems.join(" ")).toMatch(/not an amount in NOK/);
    expect(builderInput(form({ lines: [{ ...line, listPriceMinor: 1_350, price: "13,50" }] }), "EUR").raw.lines[0].unitPriceMinor).toBe(1_350);
  });

  it("refuses quantities out of range, no lines, a missing shipping price and an incomplete address", () => {
    expect(builderInput(form({ lines: [{ ...line, quantity: "0" }] }), "NOK").problems.length).toBe(1);
    expect(builderInput(form({ lines: [{ ...line, quantity: "100" }] }), "NOK").problems.length).toBe(1);
    expect(builderInput(form({ lines: [{ ...line, quantity: "1.5" }] }), "NOK").problems.length).toBe(1);
    expect(builderInput(form({ lines: [] }), "NOK").problems).toContain("Add at least one replacement.");
    expect(builderInput(form({ shipping: "set" }), "NOK").problems.join(" ")).toMatch(/shipping price/);
    expect(builderInput(form({ shipping: "set", shippingPrice: "49" }), "NOK").raw.shipping).toEqual({ kind: "set", amountMinor: 4_900 });
    expect(builderInput(form({ shipping: "standard" }), "NOK").raw.shipping).toEqual({ kind: "standard" });
    expect(builderInput(form({ address: emptyAddress() }), "NOK").problems.join(" ")).toMatch(/delivery address/);
    expect(builderInput(form({ address: { ...address, country: "Norway" } }), "NOK").problems.join(" ")).toMatch(/delivery address/);
  });
});
