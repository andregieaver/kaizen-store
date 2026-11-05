/**
 * An email list kept outside WordPress, from its own export (D446 step 2b, the owner's Decision 2: read the export as evidence): Mailchimp's
 * audience export or Klaviyo's profile export. Only someone the export says is subscribed, with the moment they subscribed, comes over; a row
 * without both is nobody (GDPR Art. 7(1): the shop must be able to show the consent). Pure; reads the file only.
 *
 * - **Mailchimp** (read 4 November 2026, *Export audience*): a zip of one file a status; the subscribed one has `Email Address`, `OPTIN_TIME`
 *   and `CONFIRM_TIME` (UTC, `YYYY-MM-DD HH:MM:SS`). The unsubscribed and cleaned files are told by their `UNSUB_TIME` and `CLEAN_TIME`
 *   columns and refused whole. Confirmed when `CONFIRM_TIME` is there (double opt-in).
 * - **Klaviyo** (profile export): `Email`, `Email Marketing Consent` (`SUBSCRIBED`, `UNSUBSCRIBED`, `NEVER_SUBSCRIBED`) and its timestamp
 *   (`Email Marketing Consent Timestamp`, ISO 8601). Confirmed when the consent was double opt-in (`Email Marketing Double Optin`, `True`).
 */
import { parseCsv, recordsOf, unescapeText } from "./csv";
import type { ConsentLine } from "./shopify-copy";

export const LIST_EXPORT_BYTES = 3_500_000;
export const LIST_EXPORT_MAX = 50_000;

export type ListSource = "mailchimp" | "klaviyo";
export type ListProblem = "empty" | "too_big" | "too_many" | "columns" | "not_subscribed_file" | "unterminated";
export type ListExport = { ok: true; source: ListSource; lines: ConsentLine[]; skipped: number } | { ok: false; problem: ListProblem };

const at = (text: string): string | null => {
  const t = text.trim();
  const plain = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/.exec(t);
  const iso = plain ? `${plain[1]}T${plain[2]}Z` : t;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/.test(iso)) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** Mailchimp's or Klaviyo's export, read: the subscribed rows with their moment, and how many rows were not. */
export function readListExport(input: Uint8Array | string): ListExport {
  if (typeof input !== "string" && input.byteLength > LIST_EXPORT_BYTES) return { ok: false, problem: "too_big" };
  const parsed = parseCsv(input);
  if (parsed.unterminated) return { ok: false, problem: "unterminated" };
  if (parsed.rows.length < 2) return { ok: false, problem: "empty" };
  const { header, records } = recordsOf(parsed.rows);
  if (records.length > LIST_EXPORT_MAX) return { ok: false, problem: "too_many" };
  const names = new Map(header.map((h) => [h.trim().toLowerCase(), h]));
  const cell = (record: Record<string, string>, name: string) => {
    const key = names.get(name);
    return key ? unescapeText(record[key] ?? "").trim() : "";
  };
  let source: ListSource;
  if (names.has("email address") && (names.has("optin_time") || names.has("confirm_time"))) {
    if (names.has("unsub_time") || names.has("clean_time")) return { ok: false, problem: "not_subscribed_file" };
    source = "mailchimp";
  } else if (names.has("email") && names.has("email marketing consent") && names.has("email marketing consent timestamp")) source = "klaviyo";
  else return { ok: false, problem: "columns" };

  const lines: ConsentLine[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const record of records) {
    const email = (source === "mailchimp" ? cell(record, "email address") : cell(record, "email")).toLowerCase();
    const name = [cell(record, "first name"), cell(record, "last name")].filter(Boolean).join(" ").slice(0, 200);
    let updatedAt: string | null;
    let confirmed: boolean;
    if (source === "mailchimp") {
      const confirm = at(cell(record, "confirm_time"));
      updatedAt = confirm ?? at(cell(record, "optin_time"));
      confirmed = confirm !== null;
    } else {
      const subscribed = cell(record, "email marketing consent").toUpperCase() === "SUBSCRIBED";
      updatedAt = subscribed ? at(cell(record, "email marketing consent timestamp")) : null;
      confirmed = /^(true|yes|1)$/i.test(cell(record, "email marketing double optin"));
    }
    if (!email.includes("@") || email.length > 254 || updatedAt === null || seen.has(email)) {
      skipped += 1;
      continue;
    }
    seen.add(email);
    lines.push({ email, name, state: "SUBSCRIBED", level: confirmed ? "CONFIRMED_OPT_IN" : "SINGLE_OPT_IN", updatedAt });
  }
  return { ok: true, source, lines, skipped };
}

/** The service a list came from, as its record is named in the words kept with each consent. */
export const LIST_RECORDED_BY: Record<ListSource, string> = { mailchimp: "Mailchimp", klaviyo: "Klaviyo" };
