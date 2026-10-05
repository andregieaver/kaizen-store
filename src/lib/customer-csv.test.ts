import { describe, expect, it } from "vitest";

import { parseCsv, writeCsv } from "./csv";
import type { FieldDef } from "./custom-fields";
import { CONSENT_NOT_RECORDED, customerColumns, customerFileRows, customerRows, onePerEmail, type CustomerRecord } from "./customer-csv";

const def = (id: string, name: string, type: FieldDef["type"]): FieldDef => ({ id, name, label: name, type, access: "private" }) as FieldDef;
const FIELDS = [def("f1", "birthday_note", "text"), def("f2", "score", "number"), def("f3", "photos", "gallery"), def("f4", "vip", "boolean")];

function customer(over: Partial<CustomerRecord> = {}): CustomerRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "kari@example.com",
    name: "Kari Nordmann",
    phone: "+4790000000",
    account: "verified",
    locale: "nb-NO",
    createdAt: "2026-01-02T10:00:00.000Z",
    lastOrderAt: "2026-09-30T08:15:00Z",
    ordersPaid: 3,
    address: { line1: "Storgata 1", line2: null, postalCode: "0150", city: "Oslo", country: "NO" },
    companyName: null,
    organisationNumber: null,
    customerGroup: "Gold",
    company: null,
    companyRole: null,
    emailOptOut: false,
    copied: false,
    fields: { birthday_note: "Likes red", score: "-3", vip: "true" },
    ...over,
  };
}

describe("the customer file", () => {
  const cols = customerColumns(FIELDS);
  const cell = (row: unknown[], name: string) => row[cols.indexOf(name)];

  it("has the contract's columns, then a column per plain custom field (never a gallery)", () => {
    expect(cols).toEqual([
      "customer_id", "email", "name", "phone", "account", "locale", "created_at", "last_order_at", "orders_paid",
      "address_line1", "address_line2", "address_postal_code", "address_city", "address_country",
      "company_name", "organisation_number", "customer_group", "company", "company_role", "email_opt_out", "marketing_consent", "copied",
      "field:birthday_note", "field:score", "field:vip",
    ]);
  });

  it("writes a row per customer with ISO dates and the field values in their cells", () => {
    const [row] = customerRows([customer()], FIELDS);
    expect(cell(row, "customer_id")).toBe("11111111-1111-4111-8111-111111111111");
    expect(cell(row, "email")).toBe("kari@example.com");
    expect(cell(row, "created_at")).toBe("2026-01-02T10:00:00Z");
    expect(cell(row, "orders_paid")).toBe(3);
    expect(cell(row, "address_city")).toBe("Oslo");
    expect(cell(row, "address_line2")).toBeNull();
    expect(cell(row, "customer_group")).toBe("Gold");
    expect(cell(row, "field:birthday_note")).toBe("Likes red");
    expect(cell(row, "field:score")).toEqual({ num: "-3" });
    expect(cell(row, "field:vip")).toBe("true");
    expect(customerFileRows([customer()], FIELDS)[0]).toEqual(cols);
  });

  it("says marketing consent is not recorded for every customer, whatever else is known, and the unsubscribe list as its own column", () => {
    const rows = customerRows([customer(), customer({ emailOptOut: true, email: "b@example.com" }), customer({ id: null, account: "none", email: "guest@example.com" })], FIELDS);
    expect(rows.map((r) => cell(r, "marketing_consent"))).toEqual([CONSENT_NOT_RECORDED, CONSENT_NOT_RECORDED, CONSENT_NOT_RECORDED]);
    expect(CONSENT_NOT_RECORDED).toBe("not_recorded");
    expect(rows.map((r) => cell(r, "email_opt_out"))).toEqual(["false", "true", "false"]);
    expect(cell(rows[2], "customer_id")).toBeNull();
    expect(cell(rows[2], "account")).toBe("none");
  });

  it("marks a customer who exists only in a copy", () => {
    expect(cell(customerRows([customer({ copied: true })], FIELDS)[0], "copied")).toBe("true");
  });

  it("has no column for a secret: no password, auth id, session, code, avatar, referral code or token", () => {
    for (const c of cols) expect([c, /password|hash|auth|session|avatar|referral|token|secret|(^|_)key|sign_?in|(^|_)code$/i.test(c) && c !== "address_postal_code"]).toEqual([c, false]);
  });

  it("never lets a cell start with a formula character, in the person's name, address, company, group or a field", () => {
    const hostile = customer({ name: "=1+1", phone: "+47", email: "-x@example.com", companyName: "@corp", customerGroup: "=VIP", address: { line1: "=A", line2: "+B", postalCode: "-1", city: "@C", country: "NO" }, fields: { birthday_note: "=HYPERLINK(1)", score: "5", vip: "true" } });
    const csv = writeCsv(customerFileRows([hostile], FIELDS), "excel_nordic");
    for (const row of parseCsv(csv).rows.slice(1)) for (const c of row) expect([c, /^[=+@\t\r\n]/.test(c)]).toEqual([c, false]);
    // The email address starts with "-": escaped as text, not a number.
    expect(csv).toContain("'-x@example.com");
  });

  it("is one per email, case-insensitively, the first of each", () => {
    const list = [customer({ email: "A@Example.com" }), customer({ email: "a@example.com", id: null }), customer({ email: "b@example.com" })];
    expect(onePerEmail(list).map((c) => c.email)).toEqual(["A@Example.com", "b@example.com"]);
  });
});
