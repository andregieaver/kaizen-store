import "server-only";

import dns from "node:dns/promises";
import https from "node:https";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { apexOf, type DomainWatch } from "@/lib/domain-health";
import { isBlockedAddress } from "@/lib/replicate-url";

import { publicRdap, type Rdap } from "./domain-health";
import { log } from "./log";
import { allowPrivate } from "./replicate-fetch";
import { uuidList } from "./sql-arrays";
import { col, typedRows } from "./typed-rows";

/**
 * The domain watch (ecosystem plan E4.2, D729): each active domain of an open store, the house store's too, is asked once a day whether it
 * still serves the store, a few a run from the five-minute dispatcher (`dispatcher.domain-watch`), those not asked for longest first. The
 * question is `https://{domain}/api/health`: the store's own health report back is fine; a TLS error is a certificate that fails; another
 * site's answer, a name that no longer resolves or nothing listening is a domain that points away; a time-out, a redirect or a server error
 * is not known, and never read as a failure. For a domain registered elsewhere, the registry's own expiry and registrar (RDAP) are kept too.
 *
 * What it found is written into the connection's checks (`store_domains.checks.watch`), the only thing it changes, and only there: the
 * Domains page's health (`hostHealth()`) and the domain alert (`domainAlertRows()`) read it through `domainHealth()`, while it is fresh
 * (`WATCH_FRESH_DAYS`). Only public addresses are asked, at the address that was looked up (as the page replicator does), with a time limit.
 * The database's triggers on that write keep the last known answer beside it (`watch.known`) and queue `domain.failing` or
 * `domain.recovered` when it turns (ecosystem plan E5.1, D757), in the same statement.
 */

/** Domains asked in one run, and at once. */
export const WATCH_PER_RUN = 20;
const WATCH_AT_ONCE = 5;
/** A domain is asked again this long after its last answer. */
export const WATCH_EVERY_HOURS = 24;
const PROBE_MS = 8_000;
const PROBE_MAX_BYTES = 16 * 1024;

export type ServingProbe = (hostname: string) => Promise<DomainWatch["serving"]>;
export type WatchDeps = { probe?: ServingProbe; rdap?: Rdap; now?: Date };

/** TLS errors Node reports for a certificate that does not hold: expired, for another name, self-signed, an issuer it cannot follow. */
const CERT_ERROR = /^(CERT_|ERR_TLS_CERT|UNABLE_TO_(GET|VERIFY)|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ERR_SSL_)/;
/** Errors that say nothing serves the address: refused, or no way there. */
const NOTHING_THERE = /^(ECONNREFUSED|EHOSTUNREACH|ENETUNREACH)$/;

/** Whether a body is the store's own health report (`/api/health`, `checkHealth()`): its status, region and commit. */
export function isOwnHealth(text: string): boolean {
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== "object" || body === null) return false;
    const b = body as Record<string, unknown>;
    return (b.status === "ok" || b.status === "degraded") && typeof b.region === "string" && "commit" in b;
  } catch {
    return false;
  }
}

/** What an answer says: the store's own health is served; another site's page is elsewhere; a redirect or a server's error is not known. */
export function servingOfAnswer(status: number, body: string | null): DomainWatch["serving"] {
  if (body !== null && isOwnHealth(body)) return "ok";
  if (status >= 300 && status < 400) return null;
  if (status >= 500 || status === 0) return null;
  return "elsewhere";
}

/** What a failed request says: a certificate that does not hold, nothing at the address, or not known (a time-out, a reset). */
export function servingOfError(code: string | undefined): DomainWatch["serving"] {
  if (!code) return null;
  if (CERT_ERROR.test(code)) return "certificate";
  if (NOTHING_THERE.test(code)) return "elsewhere";
  return null;
}

/** Asks `https://{hostname}/api/health` at the address its name has now, if that address is public. */
export const httpsProbe: ServingProbe = async (hostname) => {
  let address: string;
  let family: number;
  try {
    const found = await dns.lookup(hostname);
    address = found.address;
    family = found.family;
  } catch (error) {
    // The name has no address any more: it points nowhere. A resolver that failed to answer is not known.
    const code = (error as { code?: string })?.code ?? "";
    return code === "ENOTFOUND" || code === "ENODATA" ? "elsewhere" : null;
  }
  if (!allowPrivate() && isBlockedAddress(address)) return "elsewhere";
  return new Promise((resolve) => {
    const request = https.request(
      {
        host: hostname,
        servername: hostname,
        path: "/api/health",
        method: "GET",
        headers: { Accept: "application/json", "User-Agent": "KaizenaFlowDomainWatch/1.0" },
        timeout: PROBE_MS,
        // The connection goes to the address that was checked, whatever the name would answer now.
        lookup: (_host, options, callback) => (options?.all ? callback(null, [{ address, family }]) : callback(null, address, family)),
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > PROBE_MAX_BYTES) {
            response.destroy();
            resolve(servingOfAnswer(status, null));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve(servingOfAnswer(status, Buffer.concat(chunks).toString("utf8"))));
        response.on("error", () => resolve(null));
      },
    );
    request.on("timeout", () => request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    request.on("error", (error) => resolve(servingOfError((error as { code?: string }).code)));
    request.end();
  });
};

const DUE = z.object({ id: col.uuid, store_id: col.uuid, hostname: col.text, apex: col.textOrNull });

/** Asks the active domains due a look, a few at once, and keeps each answer in its checks. Never throws for one domain. */
export async function watchDomains(deps: WatchDeps = {}): Promise<{ checked: number; failing: number }> {
  const now = deps.now ?? new Date();
  const probe = deps.probe ?? httpsProbe;
  const rdap = deps.rdap ?? publicRdap;
  const due = await typedRows(
    DUE,
    sql`
      select d.id, d.store_id, d.hostname, d.checks ->> 'apexName' as apex
      from commerce.store_domains d
      join commerce.stores s on s.id = d.store_id
      where d.status = 'active' and (commerce.store_is_active(s.id) or s.house)
        and coalesce((d.checks -> 'watch' ->> 'at')::timestamptz, '-infinity'::timestamptz) < ${now.toISOString()}::timestamptz - make_interval(hours => ${WATCH_EVERY_HOURS})
      order by (d.checks -> 'watch' ->> 'at')::timestamptz nulls first, d.id
      limit ${WATCH_PER_RUN}
    `,
  );
  if (due.length === 0) return { checked: 0, failing: 0 };
  // Registered with Kaizena Flow: its expiry is the registration's own, never asked of the registry.
  const ours = await typedRows(
    z.object({ store_id: col.uuid, apex: col.text }),
    sql`select store_id, apex from commerce.domain_registrations
        where store_id = any(${uuidList([...new Set(due.map((d) => d.store_id))])}) and status <> 'transferred_out'`,
  );
  const registered = new Set(ours.map((r) => `${r.store_id}:${r.apex}`));
  const out = { checked: 0, failing: 0 };
  for (let i = 0; i < due.length; i += WATCH_AT_ONCE) {
    await Promise.all(
      due.slice(i, i + WATCH_AT_ONCE).map(async (d) => {
        try {
          const apex = d.apex || apexOf(d.hostname);
          const elsewhere = !registered.has(`${d.store_id}:${apex}`);
          const [serving, registry] = await Promise.all([probe(d.hostname).catch(() => null), elsewhere ? rdap(apex).catch(() => null) : Promise.resolve(null)]);
          const watch: DomainWatch = {
            at: now.toISOString(),
            serving,
            ...(elsewhere ? { expiresAt: registry?.expiresAt ?? null, registrar: registry?.registrar ?? null } : {}),
          };
          await db().execute(sql`
            update commerce.store_domains set checks = coalesce(checks, '{}'::jsonb) || jsonb_build_object('watch', ${JSON.stringify(watch)}::jsonb)
            where id = ${d.id}::uuid and store_id = ${d.store_id}::uuid and status = 'active'
          `);
          out.checked++;
          if (serving === "certificate" || serving === "elsewhere") out.failing++;
        } catch (error) {
          log("warn", "domain_watch.failed", { domain: d.id, store: d.store_id }, error);
        }
      }),
    );
  }
  return out;
}
