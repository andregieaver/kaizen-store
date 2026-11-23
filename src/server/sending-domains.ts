import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { apexOf } from "@/lib/domain-health";
import { emailSettings, type EmailSettings } from "@/lib/email-settings";
import type { SesEnv } from "@/lib/env";
import {
  cleanDomain,
  cleanFromLocal,
  FROM_LOCAL_DEFAULT,
  hostForForm,
  keptRecords,
  readResendDomain,
  senderAddress,
  SENDING_REGION,
  zoneChanges,
  type ResendDomain,
  type SendingRecord,
  type SendingStatus,
} from "@/lib/sending-domains";
import { readSesIdentity, sesRecords, sesStatusOf } from "@/lib/ses";

import { audit, type Account } from "./auth";
import { applyDnsChange, storeZone, zoneRecords } from "./domain-dns";
import { log } from "./log";
import { owned } from "./owned";
import { createSesIdentity, deleteSesIdentity, getSesIdentity, sesSettings } from "./ses";
import { col, typedRow, typedRows } from "./typed-rows";
import type { DnsHostApi } from "./vercel-dns";

/**
 * A store's own sending domain (D727, step M1.1 of `docs/audits/email-marketing-2026-11.md`), and Kaizena Flow's own when `storeId` is
 * null: the only writer of `commerce.sending_domains`. The domain is added to Resend in its EU region; its records are written into the
 * zone when Kaizena Flow keeps the store's DNS (D315), else shown to copy; Resend is asked again by the owner's *Check now* and by the
 * daily job. While a domain is verified, `senderFor()` gives the address the store's emails go from (`sendEmail()`, broadcasts); until then,
 * and whenever Resend refuses it, they go from Kaizena Flow's shared address, as before.
 *
 * While Amazon SES is set up (D872), each domain is also an identity there, with its own records written beside Resend's; once SES has
 * verified it, the store's broadcasts and flows go out through SES (`marketingRoute()`), and order emails stay on Resend.
 */

type Result<T = object> = ({ ok: true } & T) | { ok: false; problems: string[] };

export type SendingDomain = {
  id: string;
  storeId: string | null;
  domain: string;
  fromLocal: string;
  /** The address the store's emails go from once verified. */
  from: string;
  status: SendingStatus;
  records: SendingRecord[];
  recordsWritten: boolean;
  problem: string | null;
  checkedAt: string | null;
  verifiedAt: string | null;
  /** The domain at Amazon SES (D872): `none` while SES is not set up. */
  sesStatus: SesStatus;
  sesRecords: SendingRecord[];
  sesProblem: string | null;
};

export type SesStatus = "none" | SendingStatus;

/** What the server needs from outside, swapped in tests. `ses: null` is SES not set up. */
export type SendingDeps = { fetcher?: typeof fetch; settings?: EmailSettings | null; ses?: SesEnv | null; host?: DnsHostApi };

const RESEND = "https://api.resend.com";

const row = z.object({
  id: col.uuid,
  store_id: col.textOrNull,
  domain: col.text,
  from_local: col.text,
  provider_id: col.textOrNull,
  status: z.enum(["pending", "verified", "failed"]),
  records: z.unknown(),
  records_written: col.bool,
  problem: col.textOrNull,
  checked_at: col.timestampOrNull,
  verified_at: col.timestampOrNull,
  ses_status: z.enum(["none", "pending", "verified", "failed"]),
  ses_records: z.unknown(),
  ses_problem: col.textOrNull,
});
type Row = z.output<typeof row>;

const toDomain = (r: Row): SendingDomain => ({
  id: r.id,
  storeId: r.store_id,
  domain: r.domain,
  fromLocal: r.from_local,
  from: senderAddress(r.from_local, r.domain),
  status: r.status,
  records: keptRecords(r.records),
  recordsWritten: r.records_written,
  problem: r.problem,
  checkedAt: r.checked_at,
  verifiedAt: r.verified_at,
  sesStatus: r.ses_status,
  sesRecords: keptRecords(r.ses_records),
  sesProblem: r.ses_problem,
});

async function readRow(storeId: string | null): Promise<Row | null> {
  return typedRow(row, sql`select * from commerce.sending_domains where ${owned(storeId)}`);
}

/** The store's sending domain (Kaizena Flow's own for null), or null when it sends from the shared address only. */
export async function getSendingDomain(storeId: string | null): Promise<SendingDomain | null> {
  const r = await readRow(storeId);
  return r ? toDomain(r) : null;
}

/**
 * The sending domain as the admin's card shows it: each record's name worked out here, as a DNS provider's form asks for it, so the card
 * (a client component) needs no DNS code. Never Resend's id.
 */
export function sendingDomainView(d: SendingDomain) {
  return {
    domain: d.domain,
    fromLocal: d.fromLocal,
    from: d.from,
    status: d.status,
    recordsWritten: d.recordsWritten,
    checkedAt: d.checkedAt,
    // Resend's records, then SES's (D872): one list for the owner to copy, each with whether it is seen.
    records: [...d.records, ...d.sesRecords].map((r) => ({ type: r.type, name: hostForForm(r.host, d.domain), value: r.value, ...(r.priority !== undefined && { priority: r.priority }), seen: r.status === "verified" })),
  };
}

/** The address a store's emails go from, when its own domain is verified; null to use the shared address. Never throws. */
export async function senderFor(storeId: string | null): Promise<string | null> {
  try {
    const r = await typedRow(
      z.object({ domain: col.text, from_local: col.text }),
      sql`select domain, from_local from commerce.sending_domains where ${owned(storeId)} and status = 'verified'`,
    );
    return r ? senderAddress(r.from_local, r.domain) : null;
  } catch (error) {
    log("warn", "sending_domains.sender_read_failed", { storeId }, error);
    return null;
  }
}

/** How a store's marketing email goes (D872): through SES or Resend, and from which address (null: the shared `EMAIL_FROM`). */
export type MarketingRoute = { via: "ses" | "resend"; from: string | null };

/**
 * The way a store's broadcasts and flows go out (D872): from its own domain through SES while SES has verified it, else through Resend
 * while Resend has; without a verified own domain, from the shared address, through SES when the shared address's domain is Kaizena Flow's
 * own and verified there. Resend, from the shared address, whenever SES is not set up. Never throws.
 */
export async function marketingRoute(storeId: string | null, shared: string | null = emailSettings()?.from ?? null, ses: boolean = sesSettings() !== null): Promise<MarketingRoute> {
  try {
    const rows = await typedRows(
      z.object({ mine: col.bool, domain: col.text, from_local: col.text, status: col.text, ses_status: col.text }),
      sql`select coalesce(${owned(storeId)}, false) as mine, domain, from_local, status, ses_status
           from commerce.sending_domains where ${owned(storeId)} or store_id is null`,
    );
    const own = rows.find((r) => r.mine);
    if (own && ses && own.ses_status === "verified") return { via: "ses", from: senderAddress(own.from_local, own.domain) };
    if (own && own.status === "verified") return { via: "resend", from: senderAddress(own.from_local, own.domain) };
    const platform = rows.find((r) => !r.mine) ?? (storeId === null ? own : undefined);
    const sharedDomain = shared?.split("@")[1]?.toLowerCase();
    if (ses && platform && sharedDomain === platform.domain && platform.ses_status === "verified") return { via: "ses", from: null };
    return { via: "resend", from: null };
  } catch (error) {
    log("warn", "sending_domains.route_read_failed", { storeId }, error);
    return { via: "resend", from: null };
  }
}

type Call = { ok: true; body: unknown } | { ok: false; status: number; message: string };

/** One call to Resend's domains API with the platform's key. */
async function resend(settings: EmailSettings, path: string, init: { method: string; body?: unknown }, fetcher: typeof fetch): Promise<Call> {
  try {
    const response = await fetcher(`${RESEND}${path}`, {
      method: init.method,
      headers: { Authorization: `Bearer ${settings.apiKey}`, "Content-Type": "application/json" },
      ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, body };
    return { ok: false, status: response.status, message: typeof body.message === "string" ? body.message.slice(0, 300) : response.statusText };
  } catch (error) {
    return { ok: false, status: 0, message: error instanceof Error ? error.message.slice(0, 300) : "network error" };
  }
}

/** Resend's refusal in the owner's words. */
function refusal(call: Extract<Call, { ok: false }>): string {
  if (call.status === 401 || call.status === 403) return "Kaizena Flow's email key can't add domains yet. A platform admin needs to give it full access in Resend.";
  if (call.status === 0 || call.status >= 500) return "Resend can't be reached just now. Try again in a moment.";
  if (/already|registered|exists/i.test(call.message)) return "This domain is already set up for sending somewhere else. Remove it there first.";
  return `Resend refused it: ${call.message}`;
}

/**
 * Writes Resend's records into the store's zone when Kaizena Flow keeps it, leaving out what the zone already has. Answers whether the
 * zone now has them all; false (with nothing changed) when we do not keep the zone or a step failed, so the owner copies them instead.
 */
async function writeRecords(actor: Account | null, storeId: string | null, domain: string, records: readonly SendingRecord[], host?: DnsHostApi): Promise<boolean> {
  if (!storeId || records.length === 0) return false;
  const apex = apexOf(domain);
  const zone = await storeZone(storeId, apex);
  if (!zone || zone.status !== "active") return false;
  const live = await zoneRecords(storeId, apex, { host });
  if (!live.ok) return false;
  const changes = zoneChanges(records, apex, live.records);
  if (changes.length === 0) return true;
  const applied = await applyDnsChange(actor, storeId, apex, changes, { source: "recipe", rev: live.rev, automatic: actor === null, host });
  if (!applied.ok) log("warn", "sending_domains.records_not_written", { storeId, problems: applied.problems.length });
  return applied.ok;
}

/**
 * The domain at Amazon SES (D872): made there (or made again after SES gave up on it), else read; its records written where Kaizena Flow
 * keeps the zone while SES still waits for them; its state kept. Never throws.
 */
async function syncSes(actor: Account | null, current: Row, ses: SesEnv, deps: SendingDeps): Promise<void> {
  try {
    const fetcher = deps.fetcher ?? fetch;
    if (current.ses_status === "failed") await deleteSesIdentity(ses, current.domain, fetcher);
    let call = current.ses_status === "none" || current.ses_status === "failed" ? await createSesIdentity(ses, current.domain, fetcher) : await getSesIdentity(ses, current.domain, fetcher);
    if (!call.ok && call.status === 404) call = await createSesIdentity(ses, current.domain, fetcher);
    const identity = call.ok ? readSesIdentity(call.value) : null;
    const status = identity ? sesStatusOf(identity) : current.ses_status;
    const records = identity ? sesRecords(current.domain, ses.region, identity) : keptRecords(current.ses_records);
    const problem = call.ok ? (identity ? null : "Amazon SES's answer couldn't be read.") : call.problem;
    if (identity && status !== "verified") await writeRecords(actor, current.store_id, current.domain, records, deps.host).catch(() => false);
    await db().execute(sql`
      update commerce.sending_domains set ses_status = ${status}, ses_records = ${JSON.stringify(records)}::jsonb, ses_problem = ${problem}, updated_at = now()
      where id = ${current.id}::uuid and ${owned(current.store_id)}`);
    if (status !== current.ses_status) {
      await audit(actor?.id ?? null, current.store_id, "store.sending_domain_ses_status", { domain: current.domain, from: current.ses_status, to: status });
    }
  } catch (error) {
    log("error", "sending_domains.ses_sync_failed", { storeId: current.store_id }, error);
  }
}

/**
 * Adds the store's own sending domain: Resend is asked for it in the EU region, its records are written into the zone when Kaizena Flow
 * keeps it, and it is kept as `pending` until Resend sees them. One per store; the owner removes it to use another.
 */
export async function addSendingDomain(
  actor: Account,
  storeId: string | null,
  input: { domain: string; fromLocal?: string },
  deps: SendingDeps = {},
): Promise<Result<{ domain: SendingDomain }>> {
  const domain = cleanDomain(input.domain);
  const fromLocal = cleanFromLocal(input.fromLocal?.trim() || FROM_LOCAL_DEFAULT);
  const problems = [
    ...(domain ? [] : ["Type a domain, like example.no."]),
    ...(fromLocal ? [] : ["The part before the @ can use letters, numbers, dots, dashes and underscores."]),
  ];
  if (!domain || !fromLocal) return { ok: false, problems };
  if (await readRow(storeId)) return { ok: false, problems: ["This store already has a sending domain. Remove it first to use another."] };
  const settings = deps.settings === undefined ? emailSettings() : deps.settings;
  if (!settings) return { ok: false, problems: ["Kaizena Flow's email isn't set up yet."] };
  const fetcher = deps.fetcher ?? fetch;

  const made = await resend(settings, "/domains", { method: "POST", body: { name: domain, region: SENDING_REGION } }, fetcher);
  if (!made.ok) return { ok: false, problems: [refusal(made)] };
  const answer = readResendDomain(made.body, domain);
  if (!answer) return { ok: false, problems: ["Resend's answer couldn't be read. Try again in a moment."] };

  let inserted: Row | null;
  try {
    inserted = await typedRow(
      row,
      sql`
        insert into commerce.sending_domains (store_id, domain, from_local, provider_id, status, records, verified_at, created_by)
        values (${storeId}::uuid, ${domain}, ${fromLocal}, ${answer.id}, ${answer.status}, ${JSON.stringify(answer.records)}::jsonb,
          ${answer.status === "verified" ? sql`now()` : null}, ${actor.id}::uuid)
        on conflict (store_id) do nothing
        returning *
      `,
    );
  } catch (error) {
    inserted = null;
    log("error", "sending_domains.insert_failed", { storeId }, error);
  }
  if (!inserted) {
    // Two presses at once, or a write that failed: Resend's copy is let go so a later try starts clean.
    await resend(settings, `/domains/${encodeURIComponent(answer.id)}`, { method: "DELETE" }, fetcher);
    return { ok: false, problems: ["This store already has a sending domain. Remove it first to use another."] };
  }

  const written = await writeRecords(actor, storeId, domain, answer.records, deps.host).catch((error) => {
    log("warn", "sending_domains.records_write_threw", { storeId }, error);
    return false;
  });
  if (written) {
    await db().execute(sql`update commerce.sending_domains set records_written = true, updated_at = now() where id = ${inserted.id}::uuid and ${owned(storeId)}`);
    // Resend looks at once, so a zone we keep usually verifies within minutes.
    await resend(settings, `/domains/${encodeURIComponent(answer.id)}/verify`, { method: "POST" }, fetcher);
  }
  // Amazon SES too, while it is set up (D872): the broadcasts and flows go through it once it has verified the domain.
  const ses = deps.ses === undefined ? sesSettings() : deps.ses;
  if (ses) await syncSes(actor, inserted, ses, deps);
  await audit(actor.id, storeId, "store.sending_domain_added", { domain, from: senderAddress(fromLocal, domain), recordsWritten: written });
  const domainNow = await getSendingDomain(storeId);
  return domainNow ? { ok: true, domain: domainNow } : { ok: false, problems: ["The domain was added but couldn't be read back."] };
}

/**
 * Asks Resend again about the store's domain (*Check now*, and the daily job): it is asked to look at the records, then read. The status,
 * the records' own states and when it was checked are kept; a domain that becomes verified starts sending from its own address at once,
 * and one that stops being verified goes back to the shared address.
 */
export async function checkSendingDomain(actor: Account | null, storeId: string | null, deps: SendingDeps = {}): Promise<Result<{ domain: SendingDomain }>> {
  const current = await readRow(storeId);
  if (!current) return { ok: false, problems: ["This store has no sending domain."] };
  const settings = deps.settings === undefined ? emailSettings() : deps.settings;
  if (!settings) return { ok: false, problems: ["Kaizena Flow's email isn't set up yet."] };
  const fetcher = deps.fetcher ?? fetch;
  if (!current.provider_id) return { ok: false, problems: ["Remove this domain and add it again."] };
  const id = encodeURIComponent(current.provider_id);

  let records = keptRecords(current.records);
  let written = current.records_written;
  if (!written) {
    written = await writeRecords(actor, storeId, current.domain, records, deps.host).catch(() => false);
  }
  if (current.status !== "verified") await resend(settings, `/domains/${id}/verify`, { method: "POST" }, fetcher);
  const read = await resend(settings, `/domains/${id}`, { method: "GET" }, fetcher);
  let answer: ResendDomain | null = null;
  let problem: string | null = null;
  if (read.ok) {
    answer = readResendDomain(read.body, current.domain);
    if (!answer) problem = "Resend's answer couldn't be read.";
  } else {
    problem = read.status === 404 ? "Resend no longer has this domain. Remove it and add it again." : refusal(read);
  }
  if (answer) records = answer.records.length > 0 ? answer.records : records;
  const status: SendingStatus = answer?.status ?? (read.ok || read.status !== 404 ? current.status : "failed");
  await db().execute(sql`
    update commerce.sending_domains set
      status = ${status},
      records = ${JSON.stringify(records)}::jsonb,
      records_written = ${written},
      problem = ${problem},
      checked_at = now(),
      verified_at = ${status === "verified" ? sql`coalesce(verified_at, now())` : null},
      updated_at = now()
    where id = ${current.id}::uuid and ${owned(storeId)}
  `);
  if (status !== current.status) {
    await audit(actor?.id ?? null, storeId, "store.sending_domain_status", { domain: current.domain, from: current.status, to: status });
  }
  const ses = deps.ses === undefined ? sesSettings() : deps.ses;
  if (ses) await syncSes(actor, current, ses, deps);
  const domainNow = await getSendingDomain(storeId);
  return domainNow ? { ok: true, domain: domainNow } : { ok: false, problems: ["The domain couldn't be read back."] };
}

/** Changes the part before the @ (`news`, `hello`, …); the domain stays as it is verified. */
export async function setFromLocal(actor: Account, storeId: string | null, input: string): Promise<Result<{ domain: SendingDomain }>> {
  const fromLocal = cleanFromLocal(input);
  if (!fromLocal) return { ok: false, problems: ["The part before the @ can use letters, numbers, dots, dashes and underscores."] };
  const current = await readRow(storeId);
  if (!current) return { ok: false, problems: ["This store has no sending domain."] };
  await db().execute(sql`update commerce.sending_domains set from_local = ${fromLocal}, updated_at = now() where id = ${current.id}::uuid and ${owned(storeId)}`);
  await audit(actor.id, storeId, "store.sending_domain_address", { from: senderAddress(current.from_local, current.domain), to: senderAddress(fromLocal, current.domain) });
  const domainNow = await getSendingDomain(storeId);
  return domainNow ? { ok: true, domain: domainNow } : { ok: false, problems: ["The domain couldn't be read back."] };
}

/**
 * Stops sending from the store's own domain: Resend lets it go and the row is deleted, so emails go from the shared address at once. The
 * DNS records stay where they are (the owner's zone is theirs to tidy; harmless if left).
 */
export async function removeSendingDomain(actor: Account, storeId: string | null, deps: SendingDeps = {}): Promise<Result> {
  const current = await readRow(storeId);
  if (!current) return { ok: true };
  const settings = deps.settings === undefined ? emailSettings() : deps.settings;
  if (settings && current.provider_id) {
    const gone = await resend(settings, `/domains/${encodeURIComponent(current.provider_id)}`, { method: "DELETE" }, deps.fetcher ?? fetch);
    if (!gone.ok && gone.status !== 404) log("warn", "sending_domains.resend_delete_failed", { storeId, status: gone.status });
  }
  const ses = deps.ses === undefined ? sesSettings() : deps.ses;
  if (ses && current.ses_status !== "none") await deleteSesIdentity(ses, current.domain, deps.fetcher ?? fetch);
  await db().execute(sql`delete from commerce.sending_domains where id = ${current.id}::uuid and ${owned(storeId)}`);
  await audit(actor.id, storeId, "store.sending_domain_removed", { domain: current.domain });
  return { ok: true };
}

/** Domains the daily job asks Resend about: every pending or failed one, and each verified one once a week. */
export const RECHECK_BATCH = 50;

/**
 * The daily recheck (`daily.sending-domains`): pending and failed domains, those SES has not verified while it is set up (D872), and verified
 * ones a week after their last check, oldest first. Never throws for one domain; answers the counts.
 */
export async function recheckSendingDomains(deps: SendingDeps = {}): Promise<{ checked: number; verified: number; failed: number }> {
  const ses = deps.ses === undefined ? sesSettings() : deps.ses;
  const due = await typedRows(
    z.object({ store_id: col.textOrNull }),
    sql`
      select store_id from commerce.sending_domains
      where status <> 'verified' or checked_at is null or checked_at < now() - interval '7 days'
        ${ses ? sql`or ses_status <> 'verified'` : sql``}
      order by checked_at nulls first
      limit ${RECHECK_BATCH}
    `,
  );
  const counts = { checked: 0, verified: 0, failed: 0 };
  for (const d of due) {
    try {
      const result = await checkSendingDomain(null, d.store_id, { ...deps, ses });
      counts.checked += 1;
      if (result.ok && result.domain.status === "verified") counts.verified += 1;
    } catch (error) {
      counts.failed += 1;
      log("error", "sending_domains.recheck_failed", { storeId: d.store_id }, error);
    }
  }
  return counts;
}
