/**
 * Reading a customer file (wave 10 unit C, D366), pure: the header (Kaizena Flow's own customer export, or Shopify's customer export) and
 * each row into what a staff form would send (`cleanCustomerInput()`'s rules, so the import and the form agree). A row is one person by
 * their email; an empty cell leaves that detail as it is. The file never subscribes anyone and never sets a password: such columns are
 * noted once and not read. A finding names a column and never quotes a cell, as a row's email, name or phone is a person's data.
 */
import { organisationNumber } from "./b2b";
import { unescapeText } from "./csv";
import { cleanAddressParts, cleanEmail, oneLine, phoneOk, CUSTOMER_COMPANY_MAX, CUSTOMER_NAME_MAX, CUSTOMER_PHONE_MAX, type CustomerAddress } from "./customer-staff";
import { finding, type Finding } from "./data-job";
import { parseTagList, type Tag } from "./order-tags";

/** The most rows a customer file may hold. */
export const CUSTOMER_FILE_ROWS_MAX = 20_000;

export const IMPORT_COLUMNS = [
  "email",
  "name",
  "first_name",
  "last_name",
  "phone",
  "address_line1",
  "address_line2",
  "address_postal_code",
  "address_city",
  "address_country",
  "company_name",
  "organisation_number",
  "tags",
] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type HeaderIndex = Record<ImportColumn, number>;

/** A header cell as a key: lower case, letters and digits joined by one underscore ("Default Address Zip" is `default_address_zip`). */
const headerKey = (cell: string): string =>
  unescapeText(cell)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** Our own export's names, and Shopify's customer export's (with and without "Default Address"). */
const ALIASES: Record<string, ImportColumn> = {
  email: "email",
  e_mail: "email",
  name: "name",
  first_name: "first_name",
  last_name: "last_name",
  phone: "phone",
  default_address_phone: "phone",
  address_line1: "address_line1",
  address1: "address_line1",
  default_address_address1: "address_line1",
  address_line2: "address_line2",
  address2: "address_line2",
  default_address_address2: "address_line2",
  address_postal_code: "address_postal_code",
  zip: "address_postal_code",
  postal_code: "address_postal_code",
  default_address_zip: "address_postal_code",
  address_city: "address_city",
  city: "address_city",
  default_address_city: "address_city",
  address_country: "address_country",
  country_code: "address_country",
  default_address_country_code: "address_country",
  company_name: "company_name",
  company: "company_name",
  default_address_company: "company_name",
  organisation_number: "organisation_number",
  organization_number: "organisation_number",
  tags: "tags",
};

/** Columns noted and never read: marketing consent (people join the list themselves) and passwords (an import sets none). */
const MARKETING = new Set(["marketing_consent", "accepts_email_marketing", "accepts_marketing", "accepts_sms_marketing", "email_marketing_consent"]);
const PASSWORD = new Set(["password", "password_hash"]);

export function readHeader(header: readonly string[]): HeaderIndex {
  const index = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, -1])) as HeaderIndex;
  header.forEach((cell, i) => {
    const column = ALIASES[headerKey(cell)];
    if (column && index[column] === -1) index[column] = i;
  });
  return index;
}

/** The file's own notes: a column of marketing consent or of passwords is named and not read. */
export function headerNotes(header: readonly string[]): Finding[] {
  const notes: Finding[] = [];
  for (const cell of header) {
    const key = headerKey(cell);
    const column = unescapeText(cell).trim().slice(0, 60);
    if (MARKETING.has(key)) notes.push(finding("customerfile.marketing_ignored", { column }));
    if (PASSWORD.has(key)) notes.push(finding("customerfile.password_ignored", { column }));
  }
  return notes;
}

/** Whether the header names an email column; when not, the finding that says so (`file.not_customers`). */
export const checkHeader = (index: HeaderIndex): Finding | null => (index.email >= 0 ? null : finding("file.not_customers"));

/** Whether a file has more rows than an import takes. */
export const tooManyRows = (rows: number): Finding | null => (rows > CUSTOMER_FILE_ROWS_MAX ? finding("file.too_many_rows", { n: rows, max: CUSTOMER_FILE_ROWS_MAX }) : null);

/** What a row says about a person. A detail left empty is `null`: the import keeps what the store has. */
export type ParsedCustomer = {
  email: string;
  name: string | null;
  phone: string | null;
  address: CustomerAddress | null;
  company: { name: string; number: string } | null;
  tags: Tag[];
};

const cell = (cells: readonly string[], index: HeaderIndex, column: ImportColumn): string => (index[column] >= 0 ? unescapeText(cells[index[column]] ?? "") : "");

/**
 * One row, cleaned and checked as a staff form is: the email required and an email, the phone a phone number, the address whole or empty,
 * a company both a name and a valid organisation number (by the address's country, else the store's) or neither; a tag that is not one is
 * left out with a warning. The parsed row is null when an error finding makes it skipped.
 */
export function parseCustomerRow(cells: readonly string[], index: HeaderIndex, homeCountry: string | null): { row: ParsedCustomer | null; findings: Finding[] } {
  const findings: Finding[] = [];
  const typed = cell(cells, index, "email").trim();
  if (typed === "") return { row: null, findings: [finding("customerfile.email_missing", { column: "email" })] };
  const email = cleanEmail(typed);
  if (!email) return { row: null, findings: [finding("customerfile.email_invalid", { column: "email" })] };
  const whole = oneLine(cell(cells, index, "name"), CUSTOMER_NAME_MAX);
  const name = whole || oneLine(`${cell(cells, index, "first_name")} ${cell(cells, index, "last_name")}`, CUSTOMER_NAME_MAX);
  const phone = oneLine(cell(cells, index, "phone"), CUSTOMER_PHONE_MAX + 1);
  if (!phoneOk(phone)) return { row: null, findings: [finding("customerfile.phone_invalid", { column: "phone" })] };
  const address = cleanAddressParts(
    {
      line1: cell(cells, index, "address_line1"),
      line2: cell(cells, index, "address_line2"),
      postalCode: cell(cells, index, "address_postal_code"),
      city: cell(cells, index, "address_city"),
      country: cell(cells, index, "address_country"),
    },
    name,
  );
  if (!address.ok) {
    const column = { line1: "address_line1", postalCode: "address_postal_code", city: "address_city", country: "address_country" }[address.field];
    return { row: null, findings: [finding("customerfile.address_incomplete", { column })] };
  }
  const companyName = oneLine(cell(cells, index, "company_name"), CUSTOMER_COMPANY_MAX);
  const typedNumber = oneLine(cell(cells, index, "organisation_number"), 40);
  let company: ParsedCustomer["company"] = null;
  if (companyName && typedNumber) {
    const number = organisationNumber(address.address?.country ?? homeCountry, typedNumber);
    if (!number) return { row: null, findings: [finding("customerfile.company_number", { column: "organisation_number" })] };
    company = { name: companyName, number };
  } else if (companyName || typedNumber) {
    return { row: null, findings: [finding("customerfile.company_both", { column: companyName ? "organisation_number" : "company_name" })] };
  }
  const list = parseTagList(cell(cells, index, "tags"));
  if (list.problems.length > 0) findings.push(finding("customerfile.tag_skipped", { column: "tags", max: 40 }));
  return { row: { email, name: name || null, phone: phone || null, address: address.address, company, tags: list.tags }, findings };
}

/** Rows naming an email already named higher up: the first wins, the rest are skipped. */
export function duplicateFlags(rows: readonly (Pick<ParsedCustomer, "email"> | null)[]): boolean[] {
  const seen = new Set<string>();
  return rows.map((row) => {
    if (!row) return false;
    if (seen.has(row.email)) return true;
    seen.add(row.email);
    return false;
  });
}
