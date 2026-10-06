import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DraftLike } from "@/lib/draft-editor";
import { draftMarketOptions } from "@/lib/draft-markets";
import { toRates } from "@/lib/currency";
import type { DraftStatus } from "@/lib/draft-status";
import type { DraftListRow, DraftSummary } from "@/server/draft-orders";

import { DraftEditor } from "./draft-editor";
import { DraftScreen } from "./draft-screen";
import { DraftsListView } from "./drafts-list-view";
import { LinkNotice, PaidOutsideBox, SendBox } from "./draft-send";
import { DraftSentPanel } from "./draft-sent-panel";
import { DraftSummaryPanel } from "./draft-summary";
import { NewDraftForm } from "./new-draft-form";

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

const row = (over: Partial<DraftListRow> = {}): DraftListRow => ({
  id: "11111111-1111-4111-8111-111111111111",
  number: "D-12",
  status: "open",
  customer: "Kari Nordmann",
  email: "kari@example.no",
  currency: "NOK",
  totalMinor: 124900,
  orderId: null,
  orderNumber: null,
  expiresAt: null,
  createdAt: "2026-10-05T10:30:00.000Z",
  updatedAt: "2026-10-05T10:30:00.000Z",
  lineCount: 2,
  ...over,
});

const list = (over: Record<string, unknown> = {}) =>
  renderToString(h(DraftsListView, { slug: "shop", rows: [row()], status: null, nextCursor: null, hasCursor: false, openCount: 3, canWrite: true, locale: "nb-NO", timeZone: "Europe/Oslo", ...over } as never));

describe("the drafts list", () => {
  it("lists a draft with its number, customer, status, date and total in its own currency", () => {
    const html = list();
    const text = check(html);
    expect(html).toContain('href="/admin/shop/orders/drafts/11111111-1111-4111-8111-111111111111"');
    expect(text).toContain("D-12");
    expect(text).toContain("2 lines");
    expect(text).toContain("Kari Nordmann");
    expect(text).toContain("Open");
    expect(text).toMatch(/1\s?249,00/);
    expect(text).toContain("3 of 500 open drafts");
  });

  it("says where a sent draft's order and link stand, and links its order", () => {
    const html = list({ rows: [row({ status: "sent", orderId: "22222222-2222-4222-8222-222222222222", orderNumber: "1042", expiresAt: "2026-10-12T10:00:00.000Z" })] });
    const text = check(html);
    expect(text).toContain("Sent");
    expect(text).toContain("Link valid until");
    expect(text).toContain("Order #1042");
    expect(html).toContain('href="/admin/shop/orders/22222222-2222-4222-8222-222222222222"');
  });

  it("explains an expired and a cancelled draft", () => {
    expect(check(list({ rows: [row({ status: "expired" })] }))).toContain("The link ran out and the order was cancelled");
    expect(check(list({ rows: [row({ status: "cancelled" })] }))).toContain("Cancelled");
  });

  it("filters by status with links, and marks the one chosen", () => {
    const html = list({ status: "sent" });
    for (const s of ["open", "sent", "paid", "expired", "cancelled"]) expect(html).toContain(`href="/admin/shop/orders/drafts?status=${s}"`);
    expect(html).toMatch(/aria-current="page"[^>]*>Sent/);
  });

  it("offers a new draft only to someone who may change orders", () => {
    expect(check(list())).toContain("New draft order");
    expect(check(list({ canWrite: false }))).not.toContain("New draft order");
  });

  it("is empty with a way forward, and pages by a cursor", () => {
    expect(check(list({ rows: [] }))).toContain("No draft orders yet");
    expect(check(list({ rows: [], status: "paid" }))).toContain("No paid drafts.");
    const paged = list({ nextCursor: "abc", hasCursor: true });
    expect(paged).toContain('href="/admin/shop/orders/drafts?after=abc"');
    expect(check(paged)).toContain("Back to the first page");
  });

  it("shows a draft with nothing worked out as a dash and keeps free text as text", () => {
    const html = list({ rows: [row({ totalMinor: null, customer: "<b>x</b>" })] });
    expect(html).not.toContain("<b>x</b>");
    expect(check(html)).toContain("–");
  });
});

const currencies = [
  { currency: "NOK", rate: 11.5, roundTo: 1 },
  { currency: "EUR", rate: 1, roundTo: 1 },
];
const options = draftMarketOptions(
  [{ code: "NO", name: "Norge", ownLocale: "nb-NO", nativeCurrency: "NOK" }],
  { locales: ["nb-NO", "en-GB"], currencies, rates: toRates(currencies) },
);

describe("starting a draft", () => {
  it("chooses the market first: country, language and currency the store offers", () => {
    const html = renderToString(h(NewDraftForm, { options, action: async () => ({ status: "ok" as const, messages: [] as string[] }), defaultCountry: "NO" }));
    const text = check(html);
    expect(html).toContain('name="country"');
    expect(html).toContain('name="lang"');
    expect(html).toContain('name="currency"');
    expect(text).toContain("Norge");
    expect(text).toContain("EUR");
    expect(text).toContain("Start the draft");
    expect(text).toContain("/no");
  });

  it("says so when the store has no market", () => {
    const html = renderToString(h(NewDraftForm, { options: { countries: [], languages: [] }, action: async () => ({ status: "ok" as const, messages: [] as string[] }), defaultCountry: "" }));
    expect(check(html)).toContain("The store has no market yet");
  });
});

const summary = (over: Partial<DraftSummary> = {}): DraftSummary => ({
  currency: "NOK",
  lines: [
    { id: "l1", title: "Mug (White)", sku: "MUG", quantity: 2, unitPriceMinor: 24900, listPriceMinor: 24900, customPrice: false, goodsMinor: 49800, staffDiscountMinor: 4980, totalMinor: 44820, taxMinor: 8964, rate: 0.25, measure: null, currentListMinor: null, backorder: null },
    { id: "l2", title: "Engraving", sku: "CUSTOM", quantity: 1, unitPriceMinor: 5000, listPriceMinor: null, customPrice: true, goodsMinor: 5000, staffDiscountMinor: 500, totalMinor: 4500, taxMinor: 900, rate: 0.25, measure: null, currentListMinor: null, backorder: null },
    { id: "l3", title: "Coffee 250 g", sku: "COF", quantity: 1, unitPriceMinor: 8900, listPriceMinor: 9900, customPrice: true, goodsMinor: 8900, staffDiscountMinor: 0, totalMinor: 8900, taxMinor: 1157, rate: 0.15, measure: { amount: "250", unit: "g", base: "kg" }, currentListMinor: 9500, backorder: { units: 1, days: 5 } },
  ],
  subtotalMinor: 63700,
  shippingMinor: 9900,
  staffDiscountMinor: 5480,
  staffDiscountLabel: "Friend",
  taxMinor: 11021,
  totalMinor: 68120,
  vatPerRate: [
    { rate: 0.25, taxMinor: 9864, goodsMinor: 0 },
    { rate: 0.15, taxMinor: 1157, goodsMinor: 0 },
  ],
  ...over,
});

describe("the draft summary", () => {
  const panel = (props: Record<string, unknown> = {}) =>
    renderToString(h(DraftSummaryPanel, { summary: summary(), problems: [], currency: "NOK", locale: "nb-NO", state: "fresh", ...props } as never));

  it("shows each line at the price charged, the discount the buyer sees, the shipping, the total and the VAT per rate", () => {
    const text = check(panel());
    expect(text).toContain("Mug (White)");
    expect(text).toMatch(/2 × 249,00/);
    expect(text).toContain("Friend");
    expect(text).toContain("(the buyer sees this)");
    expect(text).toContain("Shipping");
    expect(text).toContain("Total");
    expect(text).toMatch(/681,20/);
    expect(text).toContain("VAT included, 25 %");
    expect(text).toContain("VAT included, 15 %");
  });

  it("marks a custom price and a custom item without showing the buyer a reduction anywhere here either way", () => {
    const text = check(panel());
    expect(text).toContain("(custom item)");
    expect(text).toContain("custom price, list 99,00");
  });

  it("says what a backorder and a moved list price mean, and the price per kg (D160)", () => {
    const text = check(panel());
    expect(text).toContain("Backorder: 1 unit, shipped within 5 days");
    expect(text).toMatch(/The list price is now 95,00 kr: save the line again to take it\./);
    expect(text).toMatch(/356,00 kr\/kg/);
  });

  it("lists the blocking problems as an alert and the notes apart", () => {
    const html = panel({ problems: [{ code: "no_email", key: null, blocking: true, text: "Add the customer's email address to send it." }, { code: "backorder", key: null, blocking: false, text: "A line is on backorder." }] });
    expect(html).toMatch(/role="alert"[^>]*>[\s\S]*Add the customer/);
    expect(check(html)).toContain("A line is on backorder.");
  });

  it("says when it is not up to date, and what to do with an empty draft", () => {
    expect(check(panel({ state: "stale" }))).toContain("Save to update");
    expect(check(panel({ state: "working" }))).toContain("Calculating");
    expect(check(panel({ summary: null }))).toContain("Add a line to see the totals.");
  });

  it("is free shipping when it costs nothing", () => {
    expect(check(panel({ summary: summary({ shippingMinor: 0 }) }))).toContain("Free");
  });
});

const draftLike = (over: Partial<DraftLike> = {}): DraftLike => ({
  marketSlug: "no",
  currency: "NOK",
  customerId: null,
  email: "kari@example.no",
  phone: null,
  shippingAddress: { name: "Kari Nordmann", line1: "Gata 1", line2: null, postalCode: "0150", city: "Oslo", country: "NO" },
  billingAddress: {},
  companyName: null,
  organisationNumber: null,
  noteToBuyer: "Thank you!",
  internalNote: "Phoned on Monday",
  tags: ["vip"],
  discount: { kind: "percent", value: "10", label: "Friend" },
  shipping: { kind: "rate", price: null },
  lines: [
    { id: "11111111-1111-4111-8111-111111111111", kind: "goods", variantId: "22222222-2222-4222-8222-222222222222", title: "Mug (White)", sku: "MUG", quantity: 2, unitPriceMinor: 24900, listPriceMinor: 24900, customPrice: false, vatCategory: null },
    { id: "33333333-3333-4333-8333-333333333333", kind: "custom", variantId: null, title: "Engraving", sku: "CUSTOM", quantity: 1, unitPriceMinor: 5000, listPriceMinor: null, customPrice: false, vatCategory: "standard" },
  ],
  ...over,
});

const asyncNo = async () => ({ ok: false as const, message: "no" });
const editorActions = {
  save: async () => ({ ok: false as const, kind: "denied" as const, message: "no" }),
  searchVariants: async () => [],
  searchCustomers: async () => [],
  customerDetails: async () => null,
  send: asyncNo,
  paidOutside: asyncNo,
  remove: asyncNo,
};
const editorProps = (over: Record<string, unknown> = {}) => ({
  number: "D-12",
  initial: draftLike(),
  version: 4,
  currency: "NOK",
  locale: "nb-NO",
  initialSummary: summary(),
  initialProblems: [],
  marketOptions: options,
  categories: [{ code: "standard", name: "Standard rate" }, { code: "food", name: "Food" }],
  defaultDays: 7,
  mayRecordOutside: true,
  actions: editorActions,
  ...over,
});

describe("the draft editor", () => {
  const draw = (over: Record<string, unknown> = {}) => renderToString(h(DraftEditor, { ...editorProps(over), onResult: () => {} } as never));

  it("shows the market, the customer, the lines, the discount, the shipping, the notes and the summary", () => {
    const html = draw();
    const text = check(html);
    for (const heading of ["Market", "Customer", "Lines", "Discount", "Shipping", "Notes and tags", "Summary", "Send it", "Mark as paid outside Kaizen"]) expect(text).toContain(heading);
    expect(html).toContain('value="kari@example.no"');
    expect(text).toContain("Mug (White)");
    expect(html).toContain('value="Engraving"');
    expect(text).toContain("Custom item");
    expect(text).toContain("D-12");
  });

  it("keeps a typed price apart from the list price: the list price is the hint, a typed one is the price", () => {
    const html = draw({ initial: draftLike({ lines: [{ id: "11111111-1111-4111-8111-111111111111", kind: "goods", variantId: "22222222-2222-4222-8222-222222222222", title: "Plate", sku: "PLT", quantity: 1, unitPriceMinor: 19900, listPriceMinor: 29900, customPrice: true, vatCategory: null }] }) });
    const text = check(html);
    expect(html).toContain('value="199,00"');
    expect(text).toContain("A custom price: it replaces the list price 299,00 and shows the customer no reduction.");
    const other = check(draw());
    expect(other).toContain("List price 249,00 in this market.");
  });

  it("says the buyer sees the discount's name, and that a note is for the buyer or for staff", () => {
    const text = check(draw());
    expect(text).toContain("the buyer sees this on the pay page, the order and the invoice");
    expect(text).toContain("never shown to the buyer; do not write about a person");
    expect(text).toContain("shown on the pay page and in the email");
  });

  it("hides the shipping choice when nothing is shipped", () => {
    const text = check(draw({ initial: draftLike({ lines: [draftLike().lines[1]] }) }));
    expect(text).not.toContain("The market's rate (and its free-over limit");
    expect(text).toContain("(nothing is shipped)");
  });

  it("offers a custom item's VAT category from the store's list and says no stock or shipping applies", () => {
    const html = draw();
    expect(html).toContain("Standard rate");
    expect(check(html)).toContain("not in the catalogue, no stock, not shipped");
  });

  it("explains that a draft takes no stock and no number until it is sent, and what sending does", () => {
    const text = check(draw());
    expect(text).toContain("Sending makes the order and takes its number, and holds the stock until the link ends.");
    expect(text).toContain("A sent draft cannot be edited: reopen it first");
  });

  it("limits the lines, quantities and notes the way the server does", () => {
    const html = draw();
    expect(html).toContain('max="9999"');
    expect(html).toContain('maxLength="500"');
    expect(html).toContain('maxLength="1000"');
    expect(html).toContain('maxLength="60"');
  });

  it("keeps free text as text", () => {
    const html = draw({ initial: draftLike({ noteToBuyer: "<script>x</script>", internalNote: "<b>y</b>" }) });
    expect(html).not.toContain("<script>x</script>");
    expect(html).not.toContain("<b>y</b>");
  });

  it("does not offer to record a payment outside Kaizen to someone the owner has not allowed", () => {
    const text = check(draw({ mayRecordOutside: false }));
    expect(text).toContain("Only the owner can record a payment taken outside Kaizen");
    expect(text).not.toContain("Record the payment");
  });
});

describe("sending and recording a payment", () => {
  it("disables the send with the reason in words", () => {
    const html = renderToString(h(SendBox, { defaultDays: 7, blockedReason: "Add the customer's email address: the pay link goes to it.", ensureSaved: async () => 1, send: asyncNo, onResult: () => {} }));
    expect(check(html)).toContain("Add the customer's email address");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send to the customer/);
    expect(html).toContain('value="7"');
  });

  it("warns beside Cash only, and asks for the customer's email first", () => {
    const html = renderToString(h(PaidOutsideBox, { allowed: true, hasEmail: false, blockedReason: null, ensureSaved: async () => 1, record: asyncNo, onResult: () => {} }));
    const text = check(html);
    expect(text).toContain("Bank transfer");
    expect(text).toContain("Cash");
    expect(text).toContain("Other");
    expect(text).toContain("takes no sale fee");
    expect(text).toContain("Add the customer's email address first");
    expect(text).not.toContain("Recording a payment here does not replace a cash register.");
  });

  it("shows a link to share with what it means that it is shown once", () => {
    const html = renderToString(h(LinkNotice, { link: "https://shop.example/s/shop/no/account/pay/abc", onClose: () => {} }));
    const text = check(html);
    expect(html).toContain('value="https://shop.example/s/shop/no/account/pay/abc"');
    expect(text).toContain("It is shown only now");
    expect(text).toContain("the old one stops working");
  });
});

describe("a draft that is not open", () => {
  const sentProps = (status: DraftStatus, over: Record<string, unknown> = {}) => ({
    slug: "shop",
    number: "D-12",
    status,
    draft: draftLike(),
    version: 5,
    orderId: status === "open" ? null : "44444444-4444-4444-8444-444444444444",
    orderNumber: status === "open" ? null : "1042",
    expiresAt: "2026-10-12T10:00:00.000Z",
    linkRanOut: false,
    linkLive: true,
    paySendsToday: 1,
    summary: summary(),
    problems: [],
    currency: "NOK",
    locale: "nb-NO",
    timeZone: "Europe/Oslo",
    canWrite: true,
    mayRecordOutside: true,
    ...over,
  });
  const actions = { resend: asyncNo, reopen: asyncNo, remove: asyncNo, paidOutside: asyncNo };
  const draw = (status: DraftStatus, over: Record<string, unknown> = {}) => renderToString(h(DraftSentPanel, { ...sentProps(status, over), actions, onResult: () => {} } as never));

  it("says a sent draft's order waits for payment, links it, and offers sending again, a link to share and a reopen", () => {
    const html = draw("sent");
    const text = check(html);
    expect(text).toContain("D-12: sent");
    expect(text).toContain("#1042");
    expect(html).toContain('href="/admin/shop/orders/44444444-4444-4444-8444-444444444444"');
    expect(text).toContain("waiting for payment");
    expect(text).toContain("Send again");
    expect(text).toContain("Create a link to share");
    expect(text).toContain("Reopen to edit");
    expect(text).toContain("Mark as paid outside Kaizen");
    expect(text).toContain("5 times a day (1 today)");
    expect(text).not.toContain("Delete draft");
  });

  it("says when the link has run out", () => {
    expect(check(draw("sent", { linkRanOut: true }))).toContain("The link has run out");
  });

  it("is final when paid: nothing to change", () => {
    const text = check(draw("paid"));
    expect(text).toContain("A paid draft is final.");
    expect(text).not.toContain("Reopen to edit");
    expect(text).not.toContain("Send again");
    expect(text).toContain("Delete draft");
  });

  it("says what became of an expired draft and offers a reopen", () => {
    const text = check(draw("expired"));
    expect(text).toContain("The order was cancelled and its stock released; the order number stays on the cancelled order");
    expect(text).toContain("Reopen to edit");
  });

  it("offers nothing to change to someone who may only read, and still shows the draft", () => {
    const text = check(draw("sent", { canWrite: false }));
    expect(text).toContain("kari@example.no");
    expect(text).toContain("Phoned on Monday");
    expect(text).not.toContain("Send again");
    expect(text).not.toContain("Reopen to edit");
    expect(text).not.toContain("Mark as paid outside Kaizen");
    expect(check(draw("open", { canWrite: false }))).toContain("only someone who may change orders can edit it");
  });

  it("keeps the customer's words as text", () => {
    const html = draw("sent", { draft: draftLike({ noteToBuyer: "<script>x</script>" }) });
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("the draft screen", () => {
  const props = (editable: boolean) => ({
    editable,
    editor: editorProps(),
    sent: {
      slug: "shop",
      number: "D-12",
      status: "sent" as DraftStatus,
      draft: draftLike(),
      version: 5,
      orderId: "44444444-4444-4444-8444-444444444444",
      orderNumber: "1042",
      expiresAt: null,
      linkRanOut: false,
      linkLive: true,
      paySendsToday: 0,
      summary: summary(),
      problems: [],
      currency: "NOK",
      locale: "nb-NO",
      timeZone: "Europe/Oslo",
      canWrite: true,
      mayRecordOutside: true,
    },
    sentActions: { resend: asyncNo, reopen: asyncNo, remove: asyncNo, paidOutside: asyncNo },
  });
  it("draws the editor for an open draft and the panel otherwise", () => {
    expect(check(renderToString(h(DraftScreen, props(true) as never)))).toContain("Save draft");
    expect(check(renderToString(h(DraftScreen, props(false) as never)))).toContain("Reopen to edit");
  });
});
