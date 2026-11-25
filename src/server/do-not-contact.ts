import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { foldAddress, foldDomain, readEntry, type DoNotContactReason } from "@/lib/do-not-contact";
import { pgTextArray } from "@/server/pg-arrays";

import { audit, type Account } from "./auth";
import { col, typedRows } from "./typed-rows";

/**
 * Do not contact, everywhere (email plan P5.6, D893): one list for every store and the platform, of addresses and company domains that said
 * no, kept as hashes (`platform_do_not_contact`). Every outreach is checked here before it is sent or offered (`mayContact()`,
 * `blockedDomains()`); nothing removes an entry.
 */

/** The hash an entry is kept under: SHA-256 of its kind and folded value, so an address and a domain of the same text never meet. */
export const entryHash = (kind: "address" | "domain", value: string): string => createHash("sha256").update(`kaizen-dnc:${kind}:${value}`).digest("hex");

/** Puts an address or a domain on the list (again is fine). An address puts only itself: a person's no is not their employer's. */
export async function addDoNotContact(
  entry: { kind: "address" | "domain"; value: string },
  reason: DoNotContactReason,
  by: { storeId: string | null; accountId: string | null },
): Promise<void> {
  await db().execute(sql`
    insert into commerce.platform_do_not_contact (kind, hash, reason, store_id, account_id)
    values (${entry.kind}, ${entryHash(entry.kind, entry.value)}, ${reason}, ${by.storeId}::uuid, ${by.accountId}::uuid)
    on conflict (kind, hash) do nothing`);
}

/** An entry typed by a store's member (someone asked by phone or letter): checked, kept, audited without the address. */
export async function addDoNotContactByHand(account: Account, storeId: string, raw: string): Promise<{ ok: true; kind: "address" | "domain" } | { ok: false }> {
  const entry = readEntry(raw.slice(0, 320));
  if (!entry) return { ok: false };
  await addDoNotContact(entry, "asked", { storeId, accountId: account.id });
  await audit(account.id, storeId, "outreach.do_not_contact_added", { kind: entry.kind });
  return { ok: true, kind: entry.kind };
}

/** Whether an address may be contacted: neither it nor its domain is on the list. */
export async function mayContact(address: string): Promise<boolean> {
  const folded = foldAddress(address);
  if (!folded) return false;
  const domain = folded.slice(folded.lastIndexOf("@") + 1);
  const rows = await typedRows(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.platform_do_not_contact
         where (kind = 'address' and hash = ${entryHash("address", folded)}) or (kind = 'domain' and hash = ${entryHash("domain", domain)})`,
  );
  return (rows[0]?.n ?? 0) === 0;
}

/** Of these websites or domains, the folded domains on the list, in one read. */
export async function blockedDomains(sites: readonly (string | null)[]): Promise<Set<string>> {
  const domains = [...new Set(sites.flatMap((s) => (s ? [foldDomain(s)] : [])).filter((d): d is string => Boolean(d)))];
  if (domains.length === 0) return new Set();
  const byHash = new Map(domains.map((d) => [entryHash("domain", d), d]));
  const rows = await typedRows(
    z.object({ hash: col.text }),
    sql`select hash from commerce.platform_do_not_contact where kind = 'domain' and hash = any(${pgTextArray([...byHash.keys()])}::text[])`,
  );
  return new Set(rows.map((r) => byHash.get(r.hash)!).filter(Boolean));
}

/** How many entries the list holds, for the page's line about it. */
export async function doNotContactCount(): Promise<number> {
  const rows = await typedRows(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.platform_do_not_contact`);
  return rows[0]?.n ?? 0;
}
