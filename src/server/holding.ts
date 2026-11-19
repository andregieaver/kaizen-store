import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { cleanHoldingRedirect, HOLDING_MODES, type HoldingMode } from "@/lib/holding";

import { audit, type Account } from "./auth";
import { forgetHolding } from "./holding-read";
import { vercelDomains, type DomainServices } from "./vercel";

type Row = Record<string, unknown>;

export { holdingFor } from "./holding-read";

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
  forgetHolding(name);
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
