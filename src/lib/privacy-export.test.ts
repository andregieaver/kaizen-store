import { describe, expect, it } from "vitest";

import {
  EXPORT_ROW_LIMIT,
  EXPORT_SCHEMA,
  cleanJson,
  collectAddresses,
  countsOf,
  emptyExportInput,
  exportFileName,
  findExcluded,
  findStrings,
  overLimit,
  serialiseExport,
  shapeExport,
  totalRows,
  validateExport,
  type ExportCounts,
  type ExportInput,
  type OrderRow,
} from "./privacy-export";
import { EXPORT_SECTIONS } from "./personal-data";

const store = { name: "Fjord Shop", legalName: "Fjord AS", organisationNumber: "999888777", contactEmail: "hei@fjord.no", country: "NO" };
const base = { generatedAt: new Date("2026-10-04T10:00:00.000Z"), language: "nb", store, bookkeepingYears: 5 };

const SECRETS = ["SECRET-HASH-1", "SECRET-TOKEN-2", "SECRET-CLIENT-3", "acct_SECRET4", "SECRET-COST-5", "SECRET-MANAGE-6", "SECRET-PDF-7", "SECRET-PM-8"];

/** An order in euros with every excluded field planted on the row, as an over-selecting query would. */
function order(over: Partial<OrderRow> = {}): OrderRow {
  const row = {
    id: "o1",
    number: "1001",
    placedAt: new Date("2026-03-01T08:00:00.000Z"),
    status: "paid",
    currency: "EUR",
    subtotalMinor: 4000,
    shippingMinor: 490,
    discountMinor: 500,
    memberDiscountMinor: 100,
    campaignDiscountMinor: 200,
    creditMinor: 100,
    referralDiscountMinor: 100,
    vatReliefMinor: 0,
    taxMinor: 700,
    totalMinor: 3990,
    vatKind: "standard",
    vatReason: "domestic",
    deliveryLabel: "Posten, home delivery",
    billingAddress: { line1: "Storgata 1", city: "Oslo", postalCode: "0155", country: "NO", token: SECRETS[1] },
    shippingAddress: { line1: "Storgata 1", city: "Oslo", postalCode: "0155", country: "NO" },
    email: "ola@example.com",
    companyName: null,
    organisationNumber: null,
    discountCode: "SPRING",
    copied: false,
    host: false,
    restrictedAt: null,
    keptUntil: null,
    anonymisedAt: null,
    lines: [
      { id: "l1", sku: "A-1", title: "Tea", quantity: 3, unitPriceMinor: 1000, taxRate: 0.25, taxMinor: 600, totalMinor: 3000, unitCostMinor: 7771 },
      { id: "l2", sku: "B-1", title: "Pot time", quantity: 1, unitPriceMinor: 1000, taxRate: "0.1", taxMinor: 100, totalMinor: 1000, bookedStartsAt: "2026-04-01T10:00:00.000Z", bookedEndsAt: "2026-04-01T11:00:00.000Z" },
    ],
    payments: [{ provider: "stripe", amountMinor: 3990, currency: "EUR", status: "captured", createdAt: new Date("2026-03-01T08:01:00.000Z"), providerReference: "pi_123", providerAccount: SECRETS[3], clientSecret: SECRETS[2] }],
    refunds: [{ amountMinor: 1000, currency: "EUR", status: "succeeded", createdAt: "2026-03-05T09:00:00.000Z", reason: "Kari phoned, wants her money back" }],
    shipments: [{ carrier: "Posten", trackingNumber: "TRK1", createdAt: "2026-03-02T09:00:00.000Z" }],
    downloads: [{ fileName: "guide.pdf", downloads: 2, token: SECRETS[1] }],
    terms: { mode: "checkbox", acceptedAt: "2026-03-01T08:00:30.000Z", locale: "nb" },
    events: [{ type: "order.paid", createdAt: "2026-03-01T08:01:00.000Z", reason: null, note: null, data: { secret: SECRETS[0] } }],
    ...over,
  } as unknown as OrderRow;
  return row;
}

function full(): ExportInput {
  return {
    ...emptyExportInput({ ...base, subject: { kind: "account", email: "ola@example.com", accountId: "c1" } }),
    profile: {
      id: "c1", email: "ola@example.com", name: "Ola Nordmann", phone: "+4712345678", address: { line1: "Storgata 1", city: "Oslo" }, locale: "nb-NO",
      createdAt: "2025-01-01T00:00:00.000Z", lastSignInAt: new Date("2026-09-01T00:00:00.000Z"), emailVerifiedAt: "2025-01-01T00:01:00.000Z",
      hasPassword: true, hasAvatar: true, companyName: null, organisationNumber: null, groupName: "Friends", groupPercent: "10.00",
      membershipCompanyName: null, membershipRole: null, passwordHash: SECRETS[0], avatarPath: "avatars/x.png", authUserId: "u1",
    } as never,
    orders: [order(), order({ id: "o2", number: "C-900", copied: true, currency: "NOK", subtotalMinor: 100000, totalMinor: 100000, discountMinor: 0, taxMinor: 20000 })],
    invoices: [{ id: "i1", documentNumber: "F1001", series: "invoice", number: 1001, orderNumber: "1001", issuedOn: "2026-03-01", issuedAt: "2026-03-01T08:02:00.000Z", currency: "EUR", netMinor: 3290, taxMinor: 700, totalMinor: 3990, vatKind: "standard", anonymised: false, snapshot: { buyer: { name: "Ola" }, publicToken: SECRETS[5] }, pdfPath: SECRETS[6] } as never],
    creditNotes: [{ id: "cn1", documentNumber: "K1", series: "credit_note", number: 1, orderNumber: "1001", issuedOn: "2026-03-05", issuedAt: "2026-03-05T09:00:00.000Z", currency: "EUR", netMinor: 800, taxMinor: 200, totalMinor: 1000, anonymised: true, snapshot: { buyer: { name: "[removed]" } }, invoiceNumber: "F1001", source: "refund" }],
    returns: [{ id: "r1", number: "1001-R1", orderNumber: "1001", kind: "withdrawal", status: "closed", reason: "changed_mind", reasonNote: "Too big", decisionNote: null, refundNote: null, staffNote: "Called, polite", refundMinor: 1000, currency: "EUR", refundedAt: "2026-03-05T09:00:00.000Z", createdAt: "2026-03-03T00:00:00.000Z", closedAt: "2026-03-06T00:00:00.000Z", lines: [{ sku: "A-1", title: "Tea", quantity: 1, decision: "accept", condition: "as_new", reason: null }], publicToken: SECRETS[1], labelUrl: "https://x" } as never],
    withdrawals: [{ id: "w1", orderNumber: "1001", name: "Ola Nordmann", email: "ola@example.com", channel: "form", status: "confirmed", submittedAt: "2026-03-03T00:00:00.000Z", confirmedAt: "2026-03-03T00:05:00.000Z", acknowledgedAt: "2026-03-03T00:05:30.000Z", lines: [{ sku: "A-1", title: "Tea", quantity: 1 }] }],
    subscriptions: [{ id: "s1", number: "S-1", status: "active", interval: "month", intervalCount: 1, currency: "EUR", subtotalMinor: 1000, shippingMinor: 0, taxMinor: 200, totalMinor: 1000, email: "ola@example.com", shippingAddress: { line1: "Storgata 1", city: "Oslo", postalCode: "0155", country: "NO" }, currentPeriodEnd: "2026-11-01T00:00:00.000Z", cancelledAt: null, createdAt: "2026-02-01T00:00:00.000Z", lines: [{ sku: "A-1", title: "Tea", quantity: 1, unitPriceMinor: 1000 }], manageToken: SECRETS[4], providerReference: "sub_123" } as never],
    standingLists: [{ id: "sl1", scheduleName: "Weekly", status: "active", shippingAddress: { line1: "Bygata 2", city: "Bergen" }, cardLabel: "Visa ••4242", consentAt: "2026-02-02T00:00:00.000Z", skipDates: ["2026-04-10"], createdAt: "2026-02-02T00:00:00.000Z", lines: [{ sku: "A-1", title: "Tea", quantity: 2 }], deliveries: [{ deliveryDate: "2026-04-03", outcome: "ordered", orderNumber: "1001" }], paymentMethod: SECRETS[7], stripeCustomer: "cus_1" } as never],
    wishlists: [{ id: "wl1", name: "Gifts", createdAt: "2026-01-01T00:00:00.000Z", items: [{ sku: "A-1", title: "Tea", quantity: 1, addedAt: "2026-01-02T00:00:00.000Z" }], browserTokenHash: SECRETS[0] } as never],
    wishlistAdds: [{ title: "Tea", sku: "A-1", quantity: 1, currency: "EUR", unitPriceMinor: 1000, createdAt: "2026-01-03T00:00:00.000Z" }],
    bonus: { currency: "NOK", balanceMinor: 5000, entries: [{ kind: "earn", amountMinor: 5000, availableAt: "2026-03-08T00:00:00.000Z", expiresAt: null, orderNumber: "1001", note: null, createdAt: "2026-03-01T08:01:00.000Z" }] },
    referrals: { affiliate: { code: "OLA10", blocked: false, blockedReason: null, createdAt: "2026-01-01T00:00:00.000Z" }, rewards: { count: 2, rewardMinor: 3000, discountMinor: 1000, currency: "NOK" }, wasReferred: true },
    consents: [{ kind: "email_opt_out", source: "unsubscribe", at: "2026-05-01T00:00:00.000Z", detail: null }, { kind: "terms", source: "order 1001", at: "2026-03-01T08:00:30.000Z", detail: "checkbox" }],
    emails: [{ id: "e1", kind: "order.confirmation", subject: "Order 1001", sentAt: "2026-03-01T08:02:00.000Z", createdAt: "2026-03-01T08:02:00.000Z", status: "sent", body: "Thanks for your order", orderNumber: "1001", html: "<p>x</p>", providerReference: "msg_1" } as never],
    carts: [{ id: "ca1", status: "converted", currency: "EUR", createdAt: "2026-03-01T07:00:00.000Z", updatedAt: "2026-03-01T08:00:00.000Z", lines: [{ sku: "A-1", title: "Tea", quantity: 3 }] }],
    abandoned: [{ capturedAt: "2026-02-01T00:00:00.000Z", remindersSent: 1, clickedAt: null, recoveredAt: null, optedOutAt: null }],
    forms: [{ kind: "form.subscription", createdAt: "2026-01-05T00:00:00.000Z", status: "confirmed" }],
    company: { company: { name: "Fjord AS", role: "employee" }, invites: [{ status: "accepted", createdAt: "2026-01-06T00:00:00.000Z", expiresAt: "2026-01-20T00:00:00.000Z", acceptedAt: "2026-01-07T00:00:00.000Z" }] },
    customFields: [{ entity: "customer", reference: null, group: "Notes", label: "Allergy", value: "Nuts", locale: null }, { entity: "order", reference: "1001", group: "Packing", label: "Gift note", value: "Happy birthday", locale: "nb" }],
  };
}

describe("shaping an export", () => {
  it("is valid, has every section and counts that add up to the rows it was given", () => {
    const file = shapeExport(full());
    expect(file.schema).toBe(EXPORT_SCHEMA);
    expect(validateExport(file)).toEqual([]);
    expect(Object.keys(file.sections).sort()).toEqual([...EXPORT_SECTIONS].sort());
    expect(file.counts).toEqual({
      profile: 1, addresses: 3, orders: 2, invoices: 1, creditNotes: 1, returns: 2, subscriptions: 1, deliveries: 1, wishlists: 2, bonus: 1, referrals: 3, consents: 2, emails: 1, carts: 2, forms: 1, company: 2, customFields: 2,
    });
    expect(totalRows(file.counts)).toBe(Object.values(file.counts).reduce((a, b) => a + b, 0));
    expect(file.generatedAt).toBe("2026-10-04T10:00:00.000Z");
  });

  it("never lets an excluded field through, even when the rows carry them (a deep scan for the planted secrets)", () => {
    const file = shapeExport(full());
    const text = JSON.stringify(file);
    for (const secret of SECRETS) expect(text.includes(secret), secret).toBe(false);
    expect(findExcluded(file)).toEqual([]);
    expect(findStrings(file, SECRETS)).toEqual([]);
    expect(text).not.toContain("pi_secret");
    expect(text).not.toContain("clientSecret");
    expect(text).not.toContain("manage");
    expect(text).not.toContain("sub_123");
    expect(text).not.toContain("msg_1");
    expect(text).not.toContain("<p>x</p>");
    // Staff cost never appears, but the unit price does.
    expect(JSON.stringify(file.sections.orders)).not.toContain("7771");
  });

  it("carries the free text staff typed about an order (a refund's reason, a cancellation's reason, a note), which is the person's data too", () => {
    const base = full();
    const orders = (base.orders as unknown as OrderRow[]).map((o, i) =>
      i === 0 ? ({ ...o, events: [{ type: "note.added", createdAt: "2026-03-06T09:00:00.000Z", reason: null, note: "Kari asked for a gift wrap" }, { type: "order.cancelled_by_staff", createdAt: "2026-03-07T09:00:00.000Z", reason: "Kari phoned", note: null }] } as unknown as OrderRow) : o,
    );
    const file = shapeExport({ ...base, orders });
    const text = JSON.stringify(file.sections.orders);
    expect(text).toContain("Kari phoned, wants her money back");
    expect(text).toContain("Kari asked for a gift wrap");
    expect(text).toContain("Kari phoned");
    expect(validateExport(file)).toEqual([]);
  });

  it("writes amounts as integers in the order's own currency, never converted", () => {
    const file = shapeExport(full());
    const [eur, nok] = file.sections.orders as Array<Record<string, unknown>>;
    expect(eur.total).toEqual({ amountMinor: 3990, currency: "EUR" });
    expect((eur.lines as Array<Record<string, unknown>>)[0].unitPrice).toEqual({ amountMinor: 1000, currency: "EUR" });
    expect((eur.payments as Array<Record<string, unknown>>)[0].amount).toEqual({ amountMinor: 3990, currency: "EUR" });
    expect((eur.discountParts as Record<string, unknown>).credit).toEqual({ amountMinor: 100, currency: "EUR" });
    expect(nok.total).toEqual({ amountMinor: 100000, currency: "NOK" });
    expect(nok.copied).toBe(true);
    expect(file.sections.bonus).toMatchObject({ balance: { amountMinor: 5000, currency: "NOK" } });
  });

  it("includes the internal staff note, the withdrawal's name and email, and the euro-view order as the rows they are", () => {
    const file = shapeExport(full());
    const returns = file.sections.returns as { returns: Array<Record<string, unknown>>; withdrawals: Array<Record<string, unknown>> };
    expect(returns.returns[0].internalStaffNote).toBe("Called, polite");
    expect(returns.returns[0].refund).toEqual({ amountMinor: 1000, currency: "EUR" });
    expect(returns.withdrawals[0]).toMatchObject({ name: "Ola Nordmann", email: "ola@example.com" });
  });

  it("collects each distinct address once with where it came from", () => {
    const input = full();
    const addresses = collectAddresses(input);
    expect(addresses).toHaveLength(3);
    const home = addresses.find((a) => (a.address as Record<string, unknown>).line1 === "Storgata 1" && (a.address as Record<string, unknown>).postalCode === "0155");
    // Order 1001 and the copied order C-900 both used it: each is a source.
    expect(home?.sources.map((s) => `${s.source}:${s.reference}`).sort()).toEqual(["order_billing:1001", "order_billing:C-900", "order_shipping:1001", "order_shipping:C-900", "subscription:S-1"]);
    // The same address typed with other case and spaces is the same address.
    const again = collectAddresses({ ...input, orders: [order({ shippingAddress: { line1: " STORGATA 1 ", city: "oslo", postalCode: "0155", country: "no" } })], subscriptions: [], profile: null, standingLists: [] });
    expect(again.map((a) => a.sources.length)).toEqual([2]);
  });

  it("gives a person with no data a file saying so: every section present, every count zero, a guest", () => {
    const empty = emptyExportInput({ ...base, subject: { kind: "guest", email: "nobody@example.com", accountId: null } });
    const file = shapeExport(empty);
    expect(validateExport(file)).toEqual([]);
    expect(Object.values(file.counts)).toEqual(EXPORT_SECTIONS.map(() => 0));
    expect(file.subject).toEqual({ kind: "guest", email: "nobody@example.com", accountId: null });
    expect(file.sections.profile).toBeNull();
    expect(file.sections.bonus).toBeNull();
    expect(file.sections.orders).toEqual([]);
    expect(file.notIncluded.length).toBeGreaterThan(5);
    // The shape of a section is the same for any subject.
    expect(Object.keys(shapeExport(full()).sections)).toEqual(Object.keys(file.sections));
    expect(Object.keys((shapeExport(full()).sections.returns as object))).toEqual(Object.keys(file.sections.returns));
  });

  it("writes the information block and the not-included list in the shopper's language, English for any other", () => {
    expect(shapeExport({ ...full(), language: "nb" }).information.rights[0]).toBe("Innsyn i opplysningene (denne filen)");
    expect(shapeExport({ ...full(), language: "sv", store: { ...store, country: "SE" } }).information.complaint).toContain("Integritetsskyddsmyndigheten");
    expect(shapeExport({ ...full(), language: "da" }).information.complaint).toContain("Datatilsynet");
    expect(shapeExport({ ...full(), language: "fi" }).information.rights[0]).toBe("Access to the information (this file)");
    expect(shapeExport({ ...full(), language: "nb" }).information.storagePeriods[0]).toContain("5 år");
  });

  it("is stable: the same rows give the same text, which ends in a newline", () => {
    const a = serialiseExport(shapeExport(full()));
    const b = serialiseExport(shapeExport(full()));
    expect(a).toBe(b);
    expect(a.endsWith("}\n")).toBe(true);
    expect(JSON.parse(a).schema).toBe(EXPORT_SCHEMA);
  });

  it("names the file for the shop and the day", () => {
    const d = new Date("2026-10-04T23:59:00.000Z");
    expect(exportFileName("fjord-shop", d, "staff")).toBe("fjord-shop-data-2026-10-04.json");
    expect(exportFileName("Fjord Shop!", d, "shopper")).toBe("fjord-shop-my-data-2026-10-04.json");
    expect(exportFileName("", d, "staff")).toBe("store-data-2026-10-04.json");
  });

  it("refuses a subject with more than 100,000 rows rather than cutting the file short", () => {
    expect(EXPORT_ROW_LIMIT).toBe(100_000);
    const counts = Object.fromEntries(EXPORT_SECTIONS.map((s) => [s, 0])) as ExportCounts;
    counts.emails = 100_000;
    expect(overLimit(counts)).toBe(false);
    counts.orders = 1;
    expect(overLimit(counts)).toBe(true);
    expect(countsOf(full()).orders).toBe(2);
  });
});

describe("checking a file", () => {
  it("finds an excluded key at any depth, a count that does not match, a section missing, and a bad amount or date", () => {
    const file = JSON.parse(JSON.stringify(shapeExport(full())));
    expect(validateExport(file)).toEqual([]);
    const broken = JSON.parse(JSON.stringify(file));
    broken.sections.orders[0].payments[0].clientSecret = "x";
    broken.counts.orders = 5;
    delete broken.sections.forms;
    broken.sections.orders[0].total.amountMinor = 12.5;
    broken.sections.orders[0].placedAt = "yesterday";
    const problems = validateExport(broken).join("\n");
    expect(problems).toContain("clientSecret");
    expect(problems).toContain("counts.orders is 5");
    expect(problems).toContain("sections has the keys");
    expect(problems).toContain("amountMinor is not an integer");
    expect(problems).toContain("placedAt is not an ISO 8601 UTC date");
    expect(validateExport(null)).toEqual(["the file is not an object"]);
  });

  it("cleans a JSON value of excluded keys and writes dates as text", () => {
    expect(cleanJson({ a: 1, token: "x", b: [{ passwordHash: "y", c: new Date("2026-01-01T00:00:00.000Z") }] })).toEqual({ a: 1, b: [{ c: "2026-01-01T00:00:00.000Z" }] });
  });
});
