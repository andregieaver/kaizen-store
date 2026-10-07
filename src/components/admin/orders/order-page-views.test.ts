import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GiftCard } from "./gift-card";
import { ArchiveButton, TagsCard } from "./order-ops";

// The refund and cancel forms bind the order page's server actions, which reach the database: the views are drawn with those actions stood in.
vi.mock("@/app/admin/(gated)/[store]/orders/actions", () => {
  const action = async () => ({ ok: true, message: null });
  return { addNoteAction: action, cancelOrderAction: action, markBalancePaidAction: action, refundOrderAction: action, resendConfirmationAction: action, sendOrderAction: action, updateContactAction: action };
});

const BAD = /\bNaN\b|Infinity|undefined|\[object|\bnull\b/;
const plain = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/[  ]/g, " ");
const check = (html: string) => {
  const text = plain(html);
  expect(text).not.toMatch(BAD);
  return text;
};

const changeTags = async () => ({ ok: true, message: null, tags: null });

describe("the tags card", () => {
  it("shows the tags with a remove button each, and a field to add with the store's tags as suggestions", () => {
    const html = renderToString(h(TagsCard, { tags: [{ key: "vip", label: "VIP" }, { key: "late", label: "Late" }], suggestions: ["VIP", "wholesale"], canWrite: true, change: changeTags }));
    const text = check(html);
    expect(text).toContain("VIP");
    expect(text).toContain("Late");
    expect(html).toContain('aria-label="Remove the tag VIP"');
    expect(html).toContain('<option value="wholesale">');
    expect(text).toContain("Add tags");
    expect(text).toContain("Up to 40 characters each, 250 on an order");
    expect(text).toContain("the customer never sees them");
  });

  it("shows the tags and nothing to change to someone who may only read", () => {
    const html = renderToString(h(TagsCard, { tags: [{ key: "vip", label: "VIP" }], suggestions: [], canWrite: false, change: changeTags }));
    expect(check(html)).toContain("VIP");
    expect(html).not.toContain("Remove the tag");
    expect(html).not.toContain("Add tags");
  });

  it("says there are none, and keeps a tag's text as text", () => {
    expect(check(renderToString(h(TagsCard, { tags: [], suggestions: [], canWrite: true, change: changeTags })))).toContain("No tags.");
    const html = renderToString(h(TagsCard, { tags: [{ key: "x", label: "<b>x</b>" }], suggestions: [], canWrite: true, change: changeTags }));
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});

describe("the archive button", () => {
  const action = async () => ({ ok: true, message: null, archived: true });
  it("archives an order that needs no more work", () => {
    const html = renderToString(h(ArchiveButton, { archived: false, blocked: null, archive: action, unarchive: action }));
    expect(check(html)).toContain("Archive");
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });

  it("is disabled with the reason in words while the order still needs work", () => {
    const html = renderToString(h(ArchiveButton, { archived: false, blocked: "It is paid and still has to be sent.", archive: action, unarchive: action }));
    expect(html).toMatch(/<button[^>]*disabled=""/);
    expect(check(html)).toContain("Cannot be archived yet: it is paid and still has to be sent.");
  });

  it("unarchives an archived order, whatever its state", () => {
    const html = renderToString(h(ArchiveButton, { archived: true, blocked: "It is paid and still has to be sent.", archive: action, unarchive: action }));
    const text = check(html);
    expect(text).toContain("Unarchive");
    expect(text).not.toContain("Cannot be archived yet");
    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });
});

describe("the gift card", () => {
  it("shows To, From and the whole message, with its line breaks kept, and a link to the price-free slip", () => {
    const html = renderToString(h(GiftCard, { gift: { isGift: true, to: "Anna", from: "Kari", message: "Happy birthday!\nSee you soon." }, slipHref: "/admin/shop/orders/abc/packing-slip" }));
    const text = check(html);
    expect(text).toContain("Anna");
    expect(text).toContain("Kari");
    expect(text).toContain("Happy birthday!\nSee you soon.");
    expect(html).toContain("whitespace-pre-wrap");
    expect(html).toContain('href="/admin/shop/orders/abc/packing-slip"');
    expect(text).toContain("Print gift slip");
    expect(text).toContain("It is not sent to the recipient.");
  });

  it("never draws the buyer's words as HTML", () => {
    const html = renderToString(h(GiftCard, { gift: { isGift: true, to: "<i>A</i>", from: null, message: "<script>alert(1)</script><b>x</b>" }, slipHref: null }));
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>x</b>");
    expect(html).not.toContain("<i>A</i>");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  it("is a gift with no message and no slip when nothing is shipped", () => {
    const html = renderToString(h(GiftCard, { gift: { isGift: true, to: null, from: null, message: null }, slipHref: null }));
    const text = check(html);
    expect(text).toContain("No message.");
    expect(text).not.toContain("Print gift slip");
  });
});

describe("the refund form for money taken outside Kaizen", () => {
  it("says the store pays the customer back and records the refund", async () => {
    const { RefundForm, CancelForm } = await import("../order-actions");
    const html = renderToString(
      h(RefundForm, { storeSlug: "shop", orderId: "o", refundable: "1249,00", refundableLabel: "1 249,00 kr", lines: [], hasEmail: true, canRefund: true, outside: { allowed: true } }),
    );
    const text = check(html);
    expect(text).toContain("This was paid outside Kaizen: pay the customer back yourself, then record it here.");
    expect(text).toContain("Kaizen cannot see whether you paid the customer back");
    expect(text).toContain("Amount you paid back");
    expect(text).toContain("Record the refund");
    expect(text).not.toContain("not taken through Kaizen's Stripe");
    const cancel = check(renderToString(h(CancelForm, { storeSlug: "shop", orderId: "o", amountLabel: "1 249,00 kr", hasEmail: true, outside: true })));
    expect(cancel).toContain("Records a refund of 1 249,00 kr (you pay the customer back yourself, Kaizen sends no money)");
  });

  it("is closed to staff the owner has not allowed, with the reason", async () => {
    const { RefundForm } = await import("../order-actions");
    const html = renderToString(h(RefundForm, { storeSlug: "shop", orderId: "o", refundable: "1249,00", refundableLabel: "1 249,00 kr", lines: [], hasEmail: true, canRefund: true, outside: { allowed: false } }));
    expect(check(html)).toContain("Only the owner can record a refund of it, unless the owner has allowed staff to");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Record the refund/);
    expect(html).not.toContain("Amount you paid back");
  });

  it("offers 'These units were not sent', ticked, only when the order has units still to send and something to put back (D174)", async () => {
    const { RefundForm } = await import("../order-actions");
    const props = { storeSlug: "shop", orderId: "o", refundable: "1249,00", refundableLabel: "1 249,00 kr", hasEmail: true, canRefund: true, lines: [{ id: "l1", title: "Tote", left: 3 }] };
    const html = renderToString(h(RefundForm, { ...props, unitsToSend: 2 }));
    expect(html).toMatch(/<input type="checkbox"[^>]*name="notSent" checked=""/);
    expect(check(html)).toContain("These units were not sent: take them off what is still to send");
    expect(check(html)).toContain("2 units are still to send.");
    expect(renderToString(h(RefundForm, { ...props, unitsToSend: 0 }))).not.toContain('name="notSent"');
    expect(renderToString(h(RefundForm, props))).not.toContain('name="notSent"');
    expect(renderToString(h(RefundForm, { ...props, lines: [], unitsToSend: 2 }))).not.toContain('name="notSent"');
  });

  it("is the ordinary Stripe refund for an ordinary order", async () => {
    const { RefundForm } = await import("../order-actions");
    const html = renderToString(h(RefundForm, { storeSlug: "shop", orderId: "o", refundable: "1249,00", refundableLabel: "1 249,00 kr", lines: [], hasEmail: true, canRefund: true }));
    const text = check(html);
    expect(text).toContain("Amount to refund");
    expect(text).toContain(">Refund<".replace(/[<>]/g, ""));
    expect(text).not.toContain("paid outside Kaizen");
  });
});
