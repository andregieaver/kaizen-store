import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db/client";
import { cleanFilters } from "@/lib/prospect-search";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));

const { addDoNotContact, addDoNotContactByHand, blockedDomains, entryHash, mayContact } = await import("./do-not-contact");
const { searchCompanies } = await import("./prospect-search");

/**
 * Do not contact, everywhere (P5.6, D893), against the database: an address or a domain is kept as a hash only, once; an address blocks
 * itself, a domain every address at it; Find companies' search marks a company whose website's domain is on the list.
 */

const run = Date.now().toString(36);

describe("do not contact (D893)", () => {
  it("keeps hashes only, blocks an address or its whole domain, and is read in one go for many sites", async () => {
    const [owner] = await db().execute<{ id: string }>(sql`insert into commerce.accounts (email, name) values (${`dnc-${run}@example.com`}, 'Dina') returning id`);
    const account = { id: owner.id, email: `dnc-${run}@example.com`, name: "Dina", platformAdmin: false } as Account;
    const domain = `firma-${run}.no`;
    expect(await mayContact(`post@${domain}`)).toBe(true);

    expect(await addDoNotContactByHand(account, null as never, `Ola@WWW.${domain.toUpperCase()}`)).toEqual({ ok: true, kind: "address" });
    expect(await mayContact(`ola@${domain}`)).toBe(false);
    expect(await mayContact(`post@${domain}`)).toBe(true);
    expect(await addDoNotContactByHand(account, null as never, "nothing")).toEqual({ ok: false });

    await addDoNotContact({ kind: "domain", value: domain }, "reply", { storeId: null, accountId: null });
    await addDoNotContact({ kind: "domain", value: domain }, "complaint", { storeId: null, accountId: null });
    expect(await mayContact(`post@${domain}`)).toBe(false);
    expect(await blockedDomains([`https://www.${domain}/kontakt`, "https://example.org", null])).toEqual(new Set([domain]));

    const rows = await db().execute<{ hash: string; n: number }>(
      sql`select hash, count(*) over ()::int as n from commerce.platform_do_not_contact where hash in (${entryHash("domain", domain)}, ${entryHash("address", `ola@${domain}`)})`,
    );
    expect(rows[0].n).toBe(2);
    expect(JSON.stringify(rows)).not.toContain(domain);
  });

  it("marks a found company whose website's domain said no, and says when the register does not answer", async () => {
    const domain = `kafe-${run}.no`;
    await addDoNotContact({ kind: "domain", value: domain }, "asked", { storeId: null, accountId: null });
    const answer = { _embedded: { enheter: [{ organisasjonsnummer: "911111111", navn: "KAFE AS", organisasjonsform: { kode: "AS" }, hjemmeside: `www.${domain}` }] }, page: { totalElements: 1, number: 0, totalPages: 1 } };
    const asked: string[] = [];
    const fake = (async (url: string) => (asked.push(url), new Response(JSON.stringify(answer), { status: 200 }))) as unknown as typeof fetch;
    const result = await searchCompanies(cleanFilters({ industries: ["56.1"] }), 0, { fetch: fake, today: "2026-11-25" });
    expect(result.ok && result.blocked.has(domain)).toBe(true);
    expect(asked[0]).toContain("naeringskode=56.1");
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    expect(await searchCompanies(cleanFilters({ industries: ["56.1"] }), 0, { fetch: down, today: "2026-11-25" })).toEqual({ ok: false });
  });
});
