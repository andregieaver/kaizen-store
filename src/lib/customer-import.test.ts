import { describe, expect, it } from "vitest";

import { CUSTOMER_FILE_ROWS_MAX, checkHeader, duplicateFlags, headerNotes, parseCustomerRow, readHeader, tooManyRows } from "./customer-import";
import { cleanCustomerInput, customerFormFields, staffProblemText } from "./customer-staff";
import { organisationNumber } from "./b2b";
import { customersEn } from "./admin-messages/customers.en";

/** Reading a customer file (wave 10 unit C, D366): the header in our own and Shopify's names, a row as a staff form would send it. */

const OURS = ["email", "name", "phone", "address_line1", "address_line2", "address_postal_code", "address_city", "address_country", "company_name", "organisation_number", "tags"];
const SHOPIFY = ["First Name", "Last Name", "Email", "Accepts Email Marketing", "Default Address Company", "Default Address Address1", "Default Address Address2", "Default Address City", "Default Address Province Code", "Default Address Country Code", "Default Address Zip", "Default Address Phone", "Phone", "Tags"];

const row = (header: string[], values: Record<string, string>) => header.map((h) => values[h] ?? "");

describe("the header", () => {
  it("reads our own export's columns", () => {
    const index = readHeader(OURS);
    expect(index.email).toBe(0);
    expect(index.address_postal_code).toBe(5);
    expect(checkHeader(index)).toBeNull();
  });

  it("reads Shopify's customer export, the first of two phone columns winning", () => {
    const index = readHeader(SHOPIFY);
    expect(index.email).toBe(2);
    expect(index.first_name).toBe(0);
    expect(index.last_name).toBe(1);
    expect(index.address_line1).toBe(5);
    expect(index.address_postal_code).toBe(10);
    expect(index.address_country).toBe(9);
    expect(index.phone).toBe(11);
    expect(index.company_name).toBe(4);
  });

  it("refuses a file with no email column", () => {
    expect(checkHeader(readHeader(["name", "phone"]))?.code).toBe("file.not_customers");
  });

  it("names a marketing or password column once and never reads it", () => {
    const notes = headerNotes([...SHOPIFY, "password"]);
    expect(notes.map((n) => n.code)).toEqual(["customerfile.marketing_ignored", "customerfile.password_ignored"]);
    expect(notes.every((n) => n.severity === "info")).toBe(true);
  });

  it("counts the rows against the limit", () => {
    expect(tooManyRows(CUSTOMER_FILE_ROWS_MAX)).toBeNull();
    expect(tooManyRows(CUSTOMER_FILE_ROWS_MAX + 1)?.code).toBe("file.too_many_rows");
  });
});

describe("a row", () => {
  const ours = readHeader(OURS);

  it("reads a whole row: a lower-case email, the address with the customer's name, tags", () => {
    const { row: parsed, findings } = parseCustomerRow(
      row(OURS, { email: "Kari@Example.com", name: "Kari Nordmann", phone: "+47 400 00 000", address_line1: "Storgata 1", address_postal_code: "0155", address_city: "Oslo", address_country: "no", tags: "vip, nyhetsbrev" }),
      ours,
      "NO",
    );
    expect(findings).toEqual([]);
    expect(parsed).toEqual({
      email: "kari@example.com",
      name: "Kari Nordmann",
      phone: "+47 400 00 000",
      address: { name: "Kari Nordmann", line1: "Storgata 1", line2: null, postalCode: "0155", city: "Oslo", country: "NO" },
      company: null,
      tags: [
        { key: "vip", label: "vip" },
        { key: "nyhetsbrev", label: "nyhetsbrev" },
      ],
    });
  });

  it("leaves empty details as null, so an import keeps what the store has", () => {
    const { row: parsed } = parseCustomerRow(row(OURS, { email: "a@example.com" }), ours, "NO");
    expect(parsed).toMatchObject({ name: null, phone: null, address: null, company: null, tags: [] });
  });

  it("joins Shopify's first and last name", () => {
    const { row: parsed } = parseCustomerRow(row(SHOPIFY, { Email: "b@example.com", "First Name": "Ola", "Last Name": "Nordmann" }), readHeader(SHOPIFY), "NO");
    expect(parsed?.name).toBe("Ola Nordmann");
  });

  it("skips a row without an email, or with one that is none, naming the column and never the cell", () => {
    expect(parseCustomerRow(row(OURS, { name: "Nobody" }), ours, "NO")).toEqual({ row: null, findings: [expect.objectContaining({ code: "customerfile.email_missing" })] });
    const bad = parseCustomerRow(row(OURS, { email: "not-an-address" }), ours, "NO");
    expect(bad.row).toBeNull();
    expect(bad.findings[0].code).toBe("customerfile.email_invalid");
    expect(bad.findings[0].text).not.toContain("not-an-address");
  });

  it("skips a row whose phone is not a phone number", () => {
    expect(parseCustomerRow(row(OURS, { email: "c@example.com", phone: "call me maybe" }), ours, "NO").findings[0].code).toBe("customerfile.phone_invalid");
  });

  it("skips a partial address, naming the part that is missing", () => {
    const { row: parsed, findings } = parseCustomerRow(row(OURS, { email: "d@example.com", address_line1: "Storgata 1", address_city: "Oslo", address_country: "NO" }), ours, "NO");
    expect(parsed).toBeNull();
    expect(findings[0]).toMatchObject({ code: "customerfile.address_incomplete", column: "address_postal_code" });
  });

  it("takes a company only with both its name and a valid number, read by the address's country", () => {
    const valid = parseCustomerRow(row(OURS, { email: "e@example.com", company_name: "Nordmann AS", organisation_number: "923 609 016" }), ours, "NO");
    expect(valid.row?.company).toEqual({ name: "Nordmann AS", number: organisationNumber("NO", "923609016") });
    expect(parseCustomerRow(row(OURS, { email: "f@example.com", company_name: "Nordmann AS" }), ours, "NO").findings[0].code).toBe("customerfile.company_both");
    expect(parseCustomerRow(row(OURS, { email: "g@example.com", company_name: "Nordmann AS", organisation_number: "123456789" }), ours, "NO").findings[0].code).toBe("customerfile.company_number");
  });

  it("leaves out a tag that is too long with a warning, and keeps the row", () => {
    const { row: parsed, findings } = parseCustomerRow(row(OURS, { email: "h@example.com", tags: `ok, ${"x".repeat(60)}` }), ours, "NO");
    expect(parsed?.tags.map((t) => t.key)).toEqual(["ok"]);
    expect(findings.map((f) => [f.code, f.severity])).toEqual([["customerfile.tag_skipped", "warning"]]);
  });

  it("agrees with the staff form on what a person's details are", () => {
    const values = { email: "I@example.com", name: "Ida", phone: "+4740000000", address_line1: "Gate 2", address_postal_code: "5003", address_city: "Bergen", address_country: "NO" };
    const fromFile = parseCustomerRow(row(OURS, values), ours, "NO").row!;
    const form = new FormData();
    for (const [k, v] of Object.entries({ email: values.email, name: values.name, phone: values.phone, line1: values.address_line1, postalCode: values.address_postal_code, city: values.address_city, country: values.address_country })) form.set(k, v);
    const fromForm = cleanCustomerInput(customerFormFields(form), organisationNumber, "NO");
    expect(fromForm.ok && { email: fromForm.input.email, name: fromForm.input.name, phone: fromForm.input.phone, address: fromForm.input.address }).toEqual({
      email: fromFile.email,
      name: fromFile.name,
      phone: fromFile.phone,
      address: fromFile.address,
    });
  });
});

describe("duplicates", () => {
  it("lets the first row of an email win", () => {
    expect(duplicateFlags([{ email: "a@x.no" }, null, { email: "b@x.no" }, { email: "a@x.no" }])).toEqual([false, false, false, true]);
  });
});

describe("the form's refusals in words", () => {
  it("has a sentence for every refusal, the address by its part", () => {
    const w = customersEn.staff.problems;
    expect(staffProblemText({ code: "address", field: "city" }, w)).toBe(w.address.city);
    for (const code of ["email", "phone", "company_both", "company_number", "taken", "not_found", "tags", "addresses", "forbidden"] as const) expect(staffProblemText({ code }, w)).toBe(w[code]);
  });
});
