import { describe, expect, it } from "vitest";

import { draftInput } from "./draft-input";
import { addGoods, addTags, customLine, fingerprint, formFromDraft, goodsLine, inputFromForm, moveLine, shipsGoods, splitTags, type DraftLike, type EditorState } from "./draft-editor";

const draft = (over: Partial<DraftLike> = {}): DraftLike => ({
  marketSlug: "no",
  currency: "NOK",
  customerId: null,
  email: "kari@example.no",
  phone: null,
  shippingAddress: { name: "Kari", line1: "Gata 1", line2: null, postalCode: "0150", city: "Oslo", country: "NO" },
  billingAddress: {},
  companyName: null,
  organisationNumber: null,
  noteToBuyer: null,
  internalNote: null,
  tags: ["vip"],
  discount: { kind: "percent", value: "10", label: "Friend" },
  shipping: { kind: "rate", price: null },
  lines: [
    { id: "11111111-1111-4111-8111-111111111111", kind: "goods", variantId: "22222222-2222-4222-8222-222222222222", title: "Mug", sku: "MUG", quantity: 2, unitPriceMinor: 24900, listPriceMinor: 24900, customPrice: false, vatCategory: null },
    { id: "33333333-3333-4333-8333-333333333333", kind: "goods", variantId: "44444444-4444-4444-8444-444444444444", title: "Plate", sku: "PLT", quantity: 1, unitPriceMinor: 19900, listPriceMinor: 29900, customPrice: true, vatCategory: null },
    { id: "55555555-5555-4555-8555-555555555555", kind: "custom", variantId: null, title: "Engraving", sku: "CUSTOM", quantity: 1, unitPriceMinor: 5000, listPriceMinor: null, customPrice: false, vatCategory: "standard" },
  ],
  ...over,
});

describe("the draft editor's state", () => {
  it("reads a saved draft as typed text: a list price is no typed price, a custom price and a custom item keep theirs", () => {
    const form = formFromDraft(draft());
    expect(form.lines.map((l) => l.price)).toEqual(["", "199,00", "50,00"]);
    expect(form.lines.map((l) => l.listPrice)).toEqual(["249,00", "299,00", null]);
    expect(form.shippingAddress.line2).toBe("");
    expect(form.discount).toEqual({ kind: "percent", value: "10", label: "Friend" });
    expect(form.tags).toEqual(["vip"]);
  });

  it("writes what the server's own schema accepts", () => {
    const input = inputFromForm(formFromDraft(draft()), 3);
    const parsed = draftInput.safeParse(input);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.version).toBe(3);
      expect(parsed.data.lines.map((l) => [l.kind, l.price ?? null])).toEqual([["goods", null], ["goods", "199,00"], ["custom", "50,00"]]);
      expect(parsed.data.shipping).toEqual({ kind: "rate" });
    }
  });

  it("sends a line's id only when it is a saved line's", () => {
    const form = formFromDraft(draft());
    form.lines.push(customLine("standard"));
    const lines = inputFromForm(form, 1).lines as { id: string | null }[];
    expect(lines.map((l) => l.id)).toEqual(["11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", "55555555-5555-4555-8555-555555555555", null]);
  });

  it("sends no shipping price when nothing is shipped, and no discount that has no value", () => {
    const form: EditorState = { ...formFromDraft(draft()), lines: [customLine("standard")], shipping: { kind: "custom", price: "49" }, discount: { kind: "amount", value: " ", label: "x" } };
    const input = inputFromForm(form, 1) as { shipping: unknown; discount: unknown };
    expect(shipsGoods(form.lines)).toBe(false);
    expect(input.shipping).toEqual({ kind: "rate" });
    expect(input.discount).toBeNull();
  });

  it("a custom shipping price goes with its kind and nothing else does", () => {
    const form: EditorState = { ...formFromDraft(draft()), shipping: { kind: "custom", price: "49" } };
    expect((inputFromForm(form, 1) as { shipping: unknown }).shipping).toEqual({ kind: "custom", price: "49" });
    expect((inputFromForm({ ...form, shipping: { kind: "free", price: "49" } }, 1) as { shipping: unknown }).shipping).toEqual({ kind: "free" });
  });

  it("notices a change and nothing else as unsaved", () => {
    const form = formFromDraft(draft());
    expect(fingerprint(form)).toBe(fingerprint(formFromDraft(draft())));
    expect(fingerprint({ ...form, email: "x@example.no" })).not.toBe(fingerprint(form));
    expect(fingerprint({ ...form, lines: moveLine(form.lines, 0, 1) })).not.toBe(fingerprint(form));
  });

  it("adds a variant already on the draft as one more unit, up to the limit, unless it has a price of its own", () => {
    const form = formFromDraft(draft());
    const mug = goodsLine({ variantId: "22222222-2222-4222-8222-222222222222", productTitle: "Mug", options: "Default", sku: "MUG", listPriceText: "249,00" });
    expect(addGoods(form.lines, mug, 9999)[0].quantity).toBe(3);
    expect(addGoods(form.lines, mug, 2)[0].quantity).toBe(2);
    const plate = goodsLine({ variantId: "44444444-4444-4444-8444-444444444444", productTitle: "Plate", options: "White", sku: "PLT", listPriceText: "299,00" });
    expect(addGoods(form.lines, plate, 9999)).toHaveLength(4);
    expect(plate.title).toBe("Plate (White)");
    expect(mug.title).toBe("Mug");
  });

  it("moves lines within the list and no further", () => {
    expect(moveLine([1, 2, 3], 0, -1)).toEqual([1, 2, 3]);
    expect(moveLine([1, 2, 3], 2, 1)).toEqual([1, 2, 3]);
    expect(moveLine([1, 2, 3], 1, -1)).toEqual([2, 1, 3]);
    expect(moveLine([1, 2, 3], 5, -1)).toEqual([1, 2, 3]);
  });

  it("splits typed tags and does not add one twice", () => {
    expect(splitTags(" vip , ,Late,")).toEqual(["vip", "Late"]);
    expect(addTags(["vip"], "VIP, wholesale")).toEqual(["vip", "wholesale"]);
  });
});
