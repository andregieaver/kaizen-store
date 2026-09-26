import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { domainInput, MAX_DOMAINS, verifyName, verifyValue, type DomainChecks } from "@/lib/custom-domains";
import { storeHosts } from "@/lib/paths";

import { audit, type Account } from "./auth";
import { domainsConfigured, vercelDomains, VercelError, type DomainServices } from "./vercel";

/**
 * Stores' own domains (P8). An owner adds one; it waits until its DNS
 * carries our TXT record with the claim's token (so a domain is only ever
 * the store's that proves it holds it) and points at Vercel, then it is
 * active and, if the store has none, its primary address. Routing to
 * domains is built into each deployment, so a change asks for a new one.
 */

type Row = Record<string, unknown>;
type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

export type StoreDomain = {
  id: string;
  hostname: string;
  token: string;
  status: "pending" | "active";
  isPrimary: boolean;
  checks: DomainChecks;
  checkedAt: string | null;
  activatedAt: string | null;
};

const toDomain = (row: Row): StoreDomain => ({
  id: String(row.id),
  hostname: String(row.hostname),
  token: String(row.token),
  status: row.status === "active" ? "active" : "pending",
  isPrimary: row.is_primary === true,
  checks: (row.checks ?? {}) as DomainChecks,
  checkedAt: row.checked_at ? new Date(String(row.checked_at)).toISOString() : null,
  activatedAt: row.activated_at ? new Date(String(row.activated_at)).toISOString() : null,
});

export async function listStoreDomains(storeId: string): Promise<StoreDomain[]> {
  const rows = await db().execute<Row>(sql`
    select id, hostname, token, status, is_primary, checks, checked_at, activated_at
    from commerce.store_domains where store_id = ${storeId}::uuid
    order by is_primary desc, status, created_at
  `);
  return rows.map(toDomain);
}

/**
 * Whether the running deployment routes the store as the database says:
 * its active domains and its primary. Otherwise a deployment is on its way.
 */
export function routedAsSaved(storeSlug: string, domains: StoreDomain[]): boolean {
  const routed = storeHosts()[storeSlug] ?? { primary: null, hosts: [] };
  const active = domains.filter((d) => d.status === "active").map((d) => d.hostname).sort();
  const primary = domains.find((d) => d.isPrimary)?.hostname ?? null;
  return routed.primary === primary && [...routed.hosts].sort().join(" ") === active.join(" ");
}

/** Deploys again so routing follows the domains (P8), noting when it was asked for. */
async function requestDeploy(services: DomainServices): Promise<void> {
  await db().execute(sql`update commerce.platform_settings set domains_deploy_requested_at = now()`);
  await services.deploy();
}

/**
 * Deploys again when the store's domains and the running deployment's
 * routing differ and no deployment was asked for in the last 15 minutes:
 * one that failed or was replaced is tried again, never more often.
 */
export async function deployIfBehind(storeSlug: string, domains: StoreDomain[], services = vercelDomains): Promise<boolean> {
  if (routedAsSaved(storeSlug, domains) || !domainsConfigured()) return false;
  const [claim] = await db().execute<Row>(sql`
    update commerce.platform_settings set domains_deploy_requested_at = now()
    where domains_deploy_requested_at is null or domains_deploy_requested_at < now() - interval '15 minutes'
    returning 1 as claimed
  `);
  if (!claim) return false;
  await services.deploy();
  return true;
}

const problemText = (error: unknown) =>
  error instanceof VercelError ? `Vercel: ${error.message}` : "The check could not finish. Try again in a minute.";

/** Adds a domain for the store to prove and point: owners only, checked by the action. */
export async function addStoreDomain(
  account: Account,
  storeId: string,
  input: unknown,
  services: DomainServices = vercelDomains,
  configured = domainsConfigured(),
): Promise<Result<{ domain: StoreDomain }>> {
  if (!configured) return { ok: false, problems: ["Custom domains are not set up on Kaizen yet."] };
  const parsed = domainInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const { hostname } = parsed.data;
  const [counts] = await db().execute<Row>(sql`
    select
      (select count(*)::int from commerce.store_domains where store_id = ${storeId}::uuid) as own,
      exists (select 1 from commerce.store_domains where store_id = ${storeId}::uuid and hostname = ${hostname}) as mine,
      exists (select 1 from commerce.store_domains where hostname = ${hostname} and status = 'active') as taken
  `);
  if (counts.mine) return { ok: false, problems: [`${hostname} is already one of your store's domains.`] };
  if (counts.taken) return { ok: false, problems: [`${hostname} is another store's address on Kaizen.`] };
  if (Number(counts.own) >= MAX_DOMAINS) return { ok: false, problems: [`A store can have at most ${MAX_DOMAINS} domains.`] };

  // On the project already when another store is claiming it too; it stays until neither needs it.
  let checks: DomainChecks;
  try {
    const found = (await services.get(hostname)) ?? (await services.add(hostname));
    checks = { vercelVerified: found.verified, challenges: found.verification, apexName: found.apexName ?? undefined };
  } catch (error) {
    return { ok: false, problems: [problemText(error)] };
  }
  const [row] = await db().execute<Row>(sql`
    insert into commerce.store_domains (store_id, hostname, token, checks, created_by)
    values (${storeId}::uuid, ${hostname}, ${randomBytes(12).toString("hex")}, ${JSON.stringify(checks)}::jsonb, ${account.id}::uuid)
    returning id, hostname, token, status, is_primary, checks, checked_at, activated_at
  `);
  await audit(account.id, storeId, "store.domain_added", { hostname });
  return { ok: true, domain: toDomain(row) };
}

/**
 * Checks a waiting domain's DNS: our TXT record, Vercel's verification and
 * where it points. With all three in place it becomes active, the store's
 * primary if it has none, and a deployment is asked for.
 */
export async function checkStoreDomain(
  storeId: string,
  domainId: string,
  services: DomainServices = vercelDomains,
): Promise<Result<{ domain: StoreDomain }>> {
  const [row] = await db().execute<Row>(sql`
    select id, hostname, token, status, is_primary, checks, checked_at, activated_at
    from commerce.store_domains where store_id = ${storeId}::uuid and id = ${domainId}::uuid
  `);
  if (!row) return { ok: false, problems: ["That domain is gone."] };
  const domain = toDomain(row);
  if (domain.status === "active") return { ok: true, domain };

  let checks: DomainChecks;
  try {
    const [txt, vercel, config] = await Promise.all([
      services.txt(verifyName(domain.hostname)),
      services.get(domain.hostname).then(async (found) => {
        const current = found ?? (await services.add(domain.hostname));
        return current.verified ? current : services.verify(domain.hostname).catch(() => current);
      }),
      services.config(domain.hostname),
    ]);
    checks = {
      txt: txt.includes(verifyValue(domain.token)),
      vercelVerified: vercel.verified,
      challenges: vercel.verification,
      apexName: vercel.apexName ?? domain.checks.apexName,
      misconfigured: config.misconfigured,
      aValues: config.aValues,
      cname: config.cname ?? undefined,
    };
  } catch (error) {
    checks = { ...domain.checks, problem: problemText(error) };
  }

  const ready = checks.txt === true && checks.vercelVerified === true && checks.misconfigured === false;
  const [taken] = ready
    ? await db().execute<Row>(sql`
        select 1 as taken from commerce.store_domains
        where hostname = ${domain.hostname} and status = 'active' and store_id <> ${storeId}::uuid
      `)
    : [];
  if (taken) checks = { ...checks, problem: `${domain.hostname} became another store's address on Kaizen first.` };

  const activate = ready && !taken;
  const save = (found: DomainChecks, active: boolean) =>
    db().execute<Row>(sql`
      update commerce.store_domains d set
        checks = ${JSON.stringify(found)}::jsonb,
        checked_at = now(),
        status = case when ${active}::boolean then 'active' else d.status end,
        activated_at = case when ${active}::boolean then now() else d.activated_at end,
        -- The first active domain becomes the store's address.
        is_primary = ${active}::boolean and not exists (
          select 1 from commerce.store_domains p where p.store_id = d.store_id and p.is_primary
        )
      where d.id = ${domain.id}::uuid
      returning id, hostname, token, status, is_primary, checks, checked_at, activated_at
    `);
  // Two stores proving the same domain at once: the database lets one have it.
  const [updated] = await save(checks, activate).catch(() =>
    save({ ...checks, problem: `${domain.hostname} became another store's address on Kaizen first.` }, false),
  );
  const result = toDomain(updated);
  if (result.status === "active") {
    await audit(null, storeId, "store.domain_activated", { hostname: result.hostname, primary: result.isPrimary });
    await requestDeploy(services).catch(() => {});
  }
  return { ok: true, domain: result };
}

/** Checks the store's waiting domains not checked in the last minute: when the owner opens the page. */
export async function checkWaitingDomains(storeId: string, services: DomainServices = vercelDomains): Promise<void> {
  if (!domainsConfigured()) return;
  const due = await db().execute<Row>(sql`
    select id from commerce.store_domains
    where store_id = ${storeId}::uuid and status = 'pending'
      and (checked_at is null or checked_at < now() - interval '1 minute')
  `);
  for (const row of due) await checkStoreDomain(storeId, String(row.id), services);
}

/** Makes an active domain the store's address, or none (its `{store}.{domain}` host). */
export async function setPrimaryDomain(
  account: Account,
  storeId: string,
  domainId: string | null,
  services: DomainServices = vercelDomains,
): Promise<Result> {
  const changed = await db().transaction(async (tx) => {
    if (domainId) {
      const [target] = await tx.execute<Row>(sql`
        select hostname from commerce.store_domains
        where store_id = ${storeId}::uuid and id = ${domainId}::uuid and status = 'active'
      `);
      if (!target) return null;
    }
    await tx.execute(sql`update commerce.store_domains set is_primary = false where store_id = ${storeId}::uuid and is_primary`);
    if (domainId) {
      await tx.execute(sql`update commerce.store_domains set is_primary = true where id = ${domainId}::uuid`);
    }
    return true;
  });
  if (!changed) return { ok: false, problems: ["Only an active domain can be the store's address."] };
  await audit(account.id, storeId, "store.domain_primary", { domainId });
  await requestDeploy(services).catch(() => {});
  return { ok: true };
}

/** Removes a domain from the store, and from Vercel once no store claims it. */
export async function removeStoreDomain(
  account: Account,
  storeId: string,
  domainId: string,
  services: DomainServices = vercelDomains,
): Promise<Result> {
  const [removed] = await db().execute<Row>(sql`
    delete from commerce.store_domains where store_id = ${storeId}::uuid and id = ${domainId}::uuid
    returning hostname, status
  `);
  if (!removed) return { ok: false, problems: ["That domain is gone."] };
  const hostname = String(removed.hostname);
  const [claimed] = await db().execute<Row>(sql`select 1 as claimed from commerce.store_domains where hostname = ${hostname}`);
  if (!claimed) await services.remove(hostname).catch(() => {});
  await audit(account.id, storeId, "store.domain_removed", { hostname });
  if (removed.status === "active") await requestDeploy(services).catch(() => {});
  return { ok: true };
}
