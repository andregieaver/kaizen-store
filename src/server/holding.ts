import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { apexOf } from "@/lib/domain-health";
import { cleanHoldingRedirect, holdingAnswer, HOLDING_MODES, type HoldingAnswer, type HoldingMode } from "@/lib/holding";

import { audit, type Account } from "./auth";
import { vercelDomains, type DomainServices } from "./vercel";

type Row = Record<string, unknown>;

/**
 * Held domains answering while no store uses them (D317 8): read by the proxy for a host that is no one else's, at most once a host and
 * instance every 30 seconds, so a change shows within a minute and with no deployment. A zone a store uses is the store's, never held here.
 */
const MEMO_MS = 30_000;
const memo = new Map<string, { at: number; answer: HoldingAnswer }>();

export async function holdingFor(host: string): Promise<HoldingAnswer> {
  const apex = apexOf(host.toLowerCase().split(":")[0].replace(/\.$/, ""));
  const kept = memo.get(apex);
  if (kept && Date.now() - kept.at < MEMO_MS) return kept.answer;
  const [row] = await db().execute<Row>(sql`
    select z.apex, z.holding, z.holding_redirect, g.country from commerce.dns_zones z
      left join commerce.domain_registrations r on r.apex = z.apex and r.status <> 'transferred_out'
      left join commerce.domain_registrants g on g.id = r.registrant_id
     where z.apex = ${apex} and z.status = 'active' and z.store_id is null and z.arrived_at is not null
     limit 1
  `);
  const answer = holdingAnswer(row ? { apex: String(row.apex), holding: String(row.holding), redirect: row.holding_redirect ? String(row.holding_redirect) : null, country: row.country ? String(row.country) : null } : null);
  if (memo.size > 5_000) memo.clear();
  memo.set(apex, { at: Date.now(), answer });
  return answer;
}

/** The holder's choice for a domain no store uses: the holding page, a redirect, or nothing. */
export async function setHolding(account: Account, apex: string, mode: string, redirect: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const name = apex.trim().toLowerCase();
  if (!(HOLDING_MODES as readonly string[]).includes(mode)) return { ok: false, problems: ["Choose what the domain shows."] };
  const to = mode === "redirect" ? cleanHoldingRedirect(redirect, name) : null;
  if (mode === "redirect" && !to) return { ok: false, problems: ["Give a whole web address on another domain, starting with https://."] };
  const rows = await db().execute<Row>(sql`
    update commerce.dns_zones set holding = ${mode as HoldingMode}, holding_redirect = ${to}, updated_at = now()
     where account_id = ${account.id}::uuid and apex = ${name} and status <> 'left'
    returning id
  `);
  if (rows.length === 0) return { ok: false, problems: [`${name} isn't one of your domains with its DNS here.`] };
  memo.delete(name);
  await audit(account.id, null, "account.domain_holding_set", { domain: name, mode });
  return { ok: true };
}

/**
 * Puts a held domain (and its www) on Kaizena Flow's Vercel project, so its holding page is served: after a registration or a move-in
 * that no store uses, and after a store stops using one. Best effort: a failure is tried again the next time.
 */
export async function serveHolding(apex: string, services: DomainServices = vercelDomains): Promise<boolean> {
  try {
    for (const host of [apex, `www.${apex}`]) if (!(await services.get(host))) await services.add(host);
    return true;
  } catch {
    return false;
  }
}
