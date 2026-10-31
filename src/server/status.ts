import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { cacheLife, cacheTag, updateTag } from "next/cache";

import { db } from "@/db/client";
import { countActiveMarkets } from "@/db/health";
import { atomFeed, type AtomEntry } from "@/lib/atom";
import { jobsNeedingLook } from "@/lib/cron-health";
import { renderEmail } from "@/lib/email-layout";
import { emailSetup } from "@/lib/email-settings";
import { publicEnv } from "@/lib/env";
import { platformPath, PLATFORM_LANG_FACTS, type PlatformLang } from "@/lib/platform-lang";
import { platformText } from "@/lib/platform-text";
import { siteUrl } from "@/lib/site";
import {
  INCIDENT_IMPACTS,
  INCIDENT_STATUSES,
  STATUS_COMPONENTS,
  STATUS_DAYS,
  alertDue,
  eventsProblem,
  stripeSilent,
  currentState,
  dayBars,
  incidentWords,
  isStatusComponent,
  overallState,
  updateWords,
  sloOf,
  uptimeBasisPoints,
  type Slo,
  type DayBar,
  type DayCount,
  type IncidentImpact,
  type IncidentStatus,
  type StatusComponent,
} from "@/lib/status";

import { audit, type Account } from "./auth";
import { cronJobRows } from "./cron-runs";
import { sendEmail } from "./email";
import { log } from "./log";
import { connectWebhookUrl, platformStripe, type WebhookKind } from "./stripe";
import { col, typedRows } from "./typed-rows";
import type { PaymentModeName } from "@/lib/stripe-account";
import { normaliseEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;

/**
 * The status page (wave 9 unit G, D360, `docs/wave-9-platform.md` section 3, G): the only writer of `commerce.status_checks`,
 * `status_incidents`, `status_incident_updates` and `status_subscribers`. Every five minutes the dispatcher runs `runStatusChecks()`, which
 * asks each component's probe and keeps one row per component measured (a probe that has nothing to measure keeps none: *Not measured*,
 * never up), emails platform admins once when a component failed `ALERT_AFTER` checks in a row, and deletes checks past 90 days. The page
 * reads `statusOverview()`, cached under `STATUS_TAG`. Incidents are platform admins' words; their emails go to confirmed subscribers only.
 */

export const STATUS_TAG = "status";
const PROBE_MS = 5000;
const CONFIRM_HOURS = 24;
/** Of emails tried in the last hour, at least this many must have gone before a failure rate is judged. */
const EMAIL_MIN_SAMPLE = 5;

/** A probe's answer, or null when there is nothing to measure (not set up). */
export type Probe = { ok: boolean; reason: string | null; ms?: number | null } | null;
export type Probes = Record<StatusComponent, () => Promise<Probe>>;

const within = <T,>(work: Promise<T>, ms = PROBE_MS): Promise<T> =>
  Promise.race([work, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

/** The admin's sign-in page fetched from here, to its last byte, in milliseconds; null when it did not answer 200 within the probe's time. */
async function adminPageMs(): Promise<number | null> {
  const started = performance.now();
  try {
    const response = await fetch(new URL("/admin/sign-in", siteUrl()), { signal: AbortSignal.timeout(PROBE_MS), cache: "no-store" });
    await response.arrayBuffer();
    return response.ok ? Math.round(performance.now() - started) : null;
  } catch {
    return null;
  }
}

const failed = (error: unknown): Probe => ({ ok: false, reason: error instanceof Error && error.message === "timeout" ? "timeout" : "error" });

/** The probes as built: the database read behind every page, Supabase's auth, Stripe, the email log and the job ledger. */
export const PROBES: Probes = {
  async website() {
    if (!process.env.DATABASE_URL) return null;
    try {
      await within(countActiveMarkets());
    } catch (error) {
      return failed(error);
    }
    // The admin's first page from where the functions run (Dublin, PSI PERF-02): timed, never a reason to call the website down.
    return { ok: true, reason: null, ms: await adminPageMs() };
  },
  async sign_in() {
    let env;
    try {
      env = publicEnv();
    } catch {
      return null;
    }
    try {
      const response = await fetch(new URL("/auth/v1/health", env.NEXT_PUBLIC_SUPABASE_URL), {
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
        signal: AbortSignal.timeout(PROBE_MS),
      });
      return response.ok ? { ok: true, reason: null } : { ok: false, reason: `http_${response.status}` };
    } catch (error) {
      return failed(error);
    }
  },
  async payments() {
    const stripe = platformStripe("live") ?? platformStripe("test");
    if (!stripe) return null;
    try {
      await within(stripe.balance.retrieve());
      const reason = eventsProblem({
        unprocessed: await unprocessedStripeEvents(),
        unheard: await within(unheardCheckouts()),
        endpointsElsewhere: await stripeEndpointsElsewhere(),
        silent: stripeSilent(await stripeTraffic()),
      });
      return { ok: reason === null, reason };
    } catch (error) {
      return failed(error);
    }
  },
  async email() {
    if (emailSetup(process.env) !== "ok") return null;
    const [row] = await db().execute<Row>(sql`
      select count(*) filter (where status = 'failed')::int as failed, count(*) filter (where status in ('sent', 'failed'))::int as tried
      from commerce.email_messages where created_at > now() - interval '1 hour'
    `);
    const tried = Number(row?.tried ?? 0);
    if (tried < EMAIL_MIN_SAMPLE) return { ok: true, reason: null };
    return Number(row?.failed ?? 0) * 5 > tried ? { ok: false, reason: "failures" } : { ok: true, reason: null };
  },
  async jobs() {
    const look = jobsNeedingLook(await cronJobRows());
    if (look.some((j) => j.health === "failing")) return { ok: false, reason: "failing" };
    if (look.some((j) => j.health === "late" && j.job.startsWith("dispatcher"))) return { ok: false, reason: "late" };
    return { ok: true, reason: null };
  },
};

/** Stripe events received more than half an hour ago and still not processed. */
async function unprocessedStripeEvents(): Promise<number> {
  const [row] = await typedRows(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.webhook_events where provider = 'stripe' and processed_at is null and received_at < now() - interval '30 minutes'`,
  );
  return row?.n ?? 0;
}

/**
 * Stripe endpoints that send somewhere other than this site (the webhooks drill's check, run with every probe, PSI REL-09). The dispatcher
 * moves them back (`keepStripeWebhooksCurrent()`); one still elsewhere means the move failed. Not counted where the site is not public.
 */
async function stripeEndpointsElsewhere(): Promise<number> {
  const origin = siteUrl();
  if (!origin.startsWith("https://") || origin.endsWith(".vercel.app")) return 0;
  const rows = await typedRows(
    z.object({ mode: col.text, kind: col.text, url: col.text }),
    sql`select mode, kind, url from commerce.platform_webhooks where provider = 'stripe'`,
  );
  return rows.filter((r) => r.url !== connectWebhookUrl(origin, r.mode as PaymentModeName, r.kind as WebhookKind)).length;
}

/** Payments Stripe took in the last six hours and the Stripe events received in them: payments with no event at all is silence (PSI REL-02). */
async function stripeTraffic(): Promise<{ payments: number; events: number }> {
  const [row] = await typedRows(
    z.object({ payments: col.int, events: col.int }),
    sql`
      select
        (select count(*)::int from commerce.payments
          where provider = 'stripe' and status in ('authorized', 'captured') and created_at > now() - interval '6 hours') as payments,
        (select count(*)::int from commerce.webhook_events where provider = 'stripe' and received_at > now() - interval '6 hours') as events
    `,
  );
  return row ?? { payments: 0, events: 0 };
}

/**
 * Of the newest Stripe checkouts still pending here after a quarter of an hour (up to three, the last day's), how many Stripe says are
 * complete and paid: each one's `checkout.session.completed` never arrived or was never applied. One read of Stripe per checkout, on its own account.
 */
async function unheardCheckouts(): Promise<number> {
  const pending = await typedRows(
    z.object({ reference: col.text, account: col.text, mode: col.text }),
    sql`
      select p.provider_reference as reference, p.provider_account as account, a.mode::text as mode
      from commerce.payments p join commerce.stripe_accounts a on a.account_id = p.provider_account
      where p.provider = 'stripe' and p.status = 'pending' and left(p.provider_reference, 3) = 'cs_'
        and p.created_at between now() - interval '1 day' and now() - interval '15 minutes'
      order by p.created_at desc limit 3
    `,
  );
  let unheard = 0;
  for (const payment of pending) {
    const stripe = platformStripe(payment.mode as PaymentModeName);
    if (!stripe) continue;
    // A checkout Stripe cannot find is not a sign of lost events; one finished but not yet paid (a bank transfer) waits for its money.
    const session = await stripe.checkout.sessions.retrieve(payment.reference, {}, { stripeAccount: payment.account }).catch(() => null);
    if (session?.status === "complete" && session.payment_status !== "unpaid") unheard++;
  }
  return unheard;
}

/** Runs every probe, keeps what was measured, emails platform admins when a component has just failed twice, and prunes. Never throws. */
export async function runStatusChecks(probes: Probes = PROBES): Promise<{ measured: number; failed: number; alerts: number }> {
  let measured = 0;
  let failedCount = 0;
  let alerts = 0;
  const answers = await Promise.all(
    STATUS_COMPONENTS.map(async (component) => {
      try {
        return [component, await probes[component]()] as const;
      } catch (error) {
        log("error", "status.probe_failed", { component }, error);
        return [component, { ok: false, reason: "error" } as Probe] as const;
      }
    }),
  );
  for (const [component, probe] of answers) {
    if (!probe) continue;
    try {
      await db().execute(sql`insert into commerce.status_checks (component, ok, reason, duration_ms) values (${component}, ${probe.ok}, ${probe.reason}, ${probe.ms ?? null})`);
      measured++;
      if (!probe.ok) {
        failedCount++;
        if (await alertAdmins(component)) alerts++;
      }
    } catch (error) {
      log("error", "status.record_failed", { component }, error);
    }
  }
  try {
    await db().execute(sql`delete from commerce.status_checks where checked_at < now() - make_interval(days => ${STATUS_DAYS + 1})`);
    await db().execute(sql`
      delete from commerce.status_subscribers where confirmed_at is null and created_at < now() - interval '7 days'
    `);
  } catch (error) {
    log("error", "status.prune_failed", {}, error);
  }
  if (measured > 0) refreshStatus();
  return { measured, failed: failedCount, alerts };
}

function refreshStatus() {
  try {
    updateTag(STATUS_TAG);
  } catch {
    // Outside a request (the job's route revalidates instead).
  }
}

/** Emails each platform admin once when the component's newest checks are its `ALERT_AFTER`-th failure in a row (keyed by that check). */
async function alertAdmins(component: StatusComponent): Promise<boolean> {
  const recent = await db().execute<Row>(sql`
    select id, ok, reason from commerce.status_checks where component = ${component} order by checked_at desc, id desc limit 3
  `);
  if (!alertDue(recent.map((r) => Boolean(r.ok)))) return false;
  const key = String(recent[0].id);
  const name = platformText("en").status.components[component];
  const reason = recent[0].reason ? String(recent[0].reason) : "error";
  const subject = `Status: ${name} failed two checks in a row`;
  const email = renderEmail({
    subject,
    preview: `The last two checks of ${name} failed (${reason}).`,
    lang: "en",
    footer: ["Kaizena Flow · kaizenaflow.com"],
    blocks: [
      { type: "heading", text: subject },
      { type: "paragraph", text: `The last two checks of ${name}, five minutes apart, failed (${reason}). You get this once until it passes again.` },
      { type: "paragraph", text: "If people are affected, post an incident so the status page and its subscribers say so." },
      { type: "button", text: "Open the status page's admin", url: `${siteUrl()}/admin/platform/status` },
    ],
  });
  const admins = await db().execute<Row>(sql`select id, email from commerce.accounts where platform_admin and disabled_at is null and email <> ''`);
  for (const admin of admins) {
    await sendEmail({ storeId: null, kind: "platform.status_alert", to: String(admin.email), email, fromName: "Kaizena Flow", idempotencyKey: `status-alert:${key}:${String(admin.id)}` });
  }
  log("warn", "status.alerted", { component, admins: admins.length });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------------------------------------------

export type IncidentView = {
  id: string;
  title: string;
  titleNb: string | null;
  impact: IncidentImpact;
  status: IncidentStatus;
  components: StatusComponent[];
  startedAt: string;
  resolvedAt: string | null;
  updates: { status: IncidentStatus; body: string; bodyNb: string | null; at: string }[];
};

export type StatusOverview = {
  components: { id: StatusComponent; state: "ok" | "degraded" | "unknown"; bars: DayBar[]; uptime: number | null; slo: Slo; checkedAt: string | null }[];
  overall: ReturnType<typeof overallState>;
  open: IncidentView[];
  recent: IncidentView[];
  at: string;
};

/** The admin's sign-in page from Dublin over the last `days` days (PSI PERF-02): the median and the slowest 5 %, from the website checks. */
export async function adminFromDublin(days = 7): Promise<{ checks: number; p50: number | null; p95: number | null }> {
  const [row] = await typedRows(
    z.object({ checks: col.int, p50: z.number().nullable(), p95: z.number().nullable() }),
    sql`select count(*)::int as checks,
          round(percentile_cont(0.5) within group (order by duration_ms))::float8 as p50,
          round(percentile_cont(0.95) within group (order by duration_ms))::float8 as p95
        from commerce.status_checks where component = 'website' and duration_ms is not null and checked_at > now() - make_interval(days => ${days})`,
  );
  return row ?? { checks: 0, p50: null, p95: null };
}

/** Incidents ongoing or started within `days` days, newest first, with their updates (newest first). */
export async function listIncidents(days = 14): Promise<IncidentView[]> {
  const rows = await db().execute<Row>(sql`
    select i.*, coalesce((
      select jsonb_agg(jsonb_build_object('status', u.status, 'body', u.body, 'bodyNb', u.body_nb, 'at', u.created_at) order by u.created_at desc)
      from commerce.status_incident_updates u where u.incident_id = i.id), '[]'::jsonb) as updates
    from commerce.status_incidents i
    where i.resolved_at is null or i.started_at > now() - make_interval(days => ${days})
    order by i.started_at desc limit 100
  `);
  return rows.map((r) => ({
    id: String(r.id),
    title: String(r.title),
    titleNb: r.title_nb ? String(r.title_nb) : null,
    impact: r.impact as IncidentImpact,
    status: r.status as IncidentStatus,
    components: ((r.components as string[]) ?? []).filter(isStatusComponent),
    startedAt: new Date(String(r.started_at)).toISOString(),
    resolvedAt: r.resolved_at ? new Date(String(r.resolved_at)).toISOString() : null,
    updates: (r.updates as { status: IncidentStatus; body: string; bodyNb: string | null; at: string }[]).map((u) => ({ ...u, at: new Date(u.at).toISOString() })),
  }));
}

/** What the status page shows, read from the checks and incidents. */
export async function readStatusOverview(now: Date = new Date()): Promise<StatusOverview> {
  const counts = await db().execute<Row>(sql`
    select component, to_char(checked_at at time zone 'UTC', 'YYYY-MM-DD') as day, count(*) filter (where ok)::int as ok, count(*)::int as total
    from commerce.status_checks where checked_at > now() - make_interval(days => ${STATUS_DAYS})
    group by 1, 2
  `);
  const newest = await db().execute<Row>(sql`
    select distinct on (component) component, ok, checked_at from commerce.status_checks order by component, checked_at desc
  `);
  const incidents = await listIncidents();
  const components = STATUS_COMPONENTS.map((id) => {
    const days: DayCount[] = counts.filter((c) => c.component === id).map((c) => ({ day: String(c.day), ok: Number(c.ok), total: Number(c.total) }));
    const last = newest.find((n) => n.component === id);
    const bars = dayBars(days, now);
    return {
      id,
      state: currentState(last ? { ok: Boolean(last.ok) } : null),
      bars,
      uptime: uptimeBasisPoints(bars),
      slo: sloOf(id, bars),
      checkedAt: last ? new Date(String(last.checked_at)).toISOString() : null,
    };
  });
  const open = incidents.filter((i) => !i.resolvedAt);
  return {
    components,
    overall: overallState(
      components.map((c) => c.state),
      open,
    ),
    open,
    recent: incidents.filter((i) => i.resolvedAt),
    at: now.toISOString(),
  };
}

/** The page's read, cached a minute under `STATUS_TAG` (each run of the checks and each incident refreshes it). */
export async function statusOverview(): Promise<StatusOverview> {
  "use cache";
  cacheLife("minutes");
  cacheTag(STATUS_TAG);
  return readStatusOverview();
}

/** The incidents as an Atom feed in a language: each update an entry, newest first. */
export async function statusFeed(lang: PlatformLang): Promise<string> {
  const w = platformText(lang).status;
  const page = `${siteUrl()}${platformPath(lang, "/status")}`;
  const incidents = await listIncidents(90);
  const entries: AtomEntry[] = incidents.flatMap((incident) =>
    incident.updates.map((u, i) => ({
      id: `${page}#${incident.id}-${incident.updates.length - i}`,
      title: `${w.statuses[u.status]}: ${incidentWords(incident, lang)}`,
      link: `${page}#incident-${incident.id}`,
      summary: updateWords(u, lang),
      published: u.at,
      updated: u.at,
      author: "Kaizena Flow",
    })),
  );
  entries.sort((a, b) => b.updated.localeCompare(a.updated));
  return atomFeed({
    id: page,
    title: `Kaizena Flow · ${w.title}`,
    link: page,
    self: `${page}/feed.atom`,
    lang: PLATFORM_LANG_FACTS[lang].tag,
    author: "Kaizena Flow",
    entries,
    fallbackUpdated: new Date(0).toISOString(),
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Incidents
// ---------------------------------------------------------------------------------------------------------------------------------

export type IncidentInput = {
  title: string;
  titleNb?: string | null;
  impact: string;
  components: string[];
  body: string;
  bodyNb?: string | null;
};

const clean = (value: string | null | undefined, max: number) => (value ?? "").trim().slice(0, max);
type Problem = "title" | "body" | "impact" | "status" | "components" | "unknown";

/** Posts an incident with its first update (`investigating`), emails confirmed subscribers and refreshes the page. */
export async function postIncident(admin: Account, input: IncidentInput): Promise<{ ok: true; id: string; emailed: number } | { ok: false; problem: Problem }> {
  const title = clean(input.title, 120);
  const body = clean(input.body, 2000);
  if (!title) return { ok: false, problem: "title" };
  if (!body) return { ok: false, problem: "body" };
  if (!(INCIDENT_IMPACTS as readonly string[]).includes(input.impact)) return { ok: false, problem: "impact" };
  const components = [...new Set(input.components)].filter(isStatusComponent);
  if (components.length === 0 && input.impact !== "maintenance") return { ok: false, problem: "components" };
  const titleNb = clean(input.titleNb, 120) || null;
  const bodyNb = clean(input.bodyNb, 2000) || null;
  const id = await db().transaction(async (tx) => {
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.status_incidents (title, title_nb, impact, components, created_by)
      values (${title}, ${titleNb}, ${input.impact}, ${`{${components.join(",")}}`}::text[], ${admin.id}::uuid) returning id
    `);
    await tx.execute(sql`
      insert into commerce.status_incident_updates (incident_id, status, body, body_nb, created_by)
      values (${row.id}::uuid, 'investigating', ${body}, ${bodyNb}, ${admin.id}::uuid)
    `);
    return String(row.id);
  });
  await audit(admin.id, null, "platform.status_incident_posted", { incident: id, impact: input.impact });
  refreshStatus();
  return { ok: true, id, emailed: await emailSubscribers(id) };
}

/** Adds an update to an incident (resolving it with `resolved`), emails confirmed subscribers and refreshes the page. */
export async function updateIncident(
  admin: Account,
  incidentId: string,
  input: { status: string; body: string; bodyNb?: string | null },
): Promise<{ ok: true; emailed: number } | { ok: false; problem: Problem }> {
  const body = clean(input.body, 2000);
  if (!body) return { ok: false, problem: "body" };
  if (!(INCIDENT_STATUSES as readonly string[]).includes(input.status)) return { ok: false, problem: "status" };
  if (!/^[0-9a-f-]{36}$/i.test(incidentId)) return { ok: false, problem: "unknown" };
  const done = await db().transaction(async (tx) => {
    const [incident] = await tx.execute<Row>(sql`
      update commerce.status_incidents
         set status = ${input.status}, resolved_at = case when ${input.status} = 'resolved' then coalesce(resolved_at, now()) else null end
       where id = ${incidentId}::uuid returning id
    `);
    if (!incident) return false;
    await tx.execute(sql`
      insert into commerce.status_incident_updates (incident_id, status, body, body_nb, created_by)
      values (${incidentId}::uuid, ${input.status}, ${body}, ${clean(input.bodyNb, 2000) || null}, ${admin.id}::uuid)
    `);
    return true;
  });
  if (!done) return { ok: false, problem: "unknown" };
  await audit(admin.id, null, "platform.status_incident_updated", { incident: incidentId, status: input.status });
  refreshStatus();
  return { ok: true, emailed: await emailSubscribers(incidentId) };
}

/** Emails the incident's newest update to every confirmed subscriber, in their language, once per update. Never throws. */
async function emailSubscribers(incidentId: string): Promise<number> {
  let sent = 0;
  try {
    const [incident] = await listIncidentById(incidentId);
    if (!incident) return 0;
    const update = incident.updates[0];
    const subscribers = await db().execute<Row>(sql`select id, email, locale, unsubscribe_token from commerce.status_subscribers where confirmed_at is not null`);
    for (const subscriber of subscribers) {
      const lang: PlatformLang = subscriber.locale === "nb-NO" ? "nb" : "en";
      const w = platformText(lang).status;
      const title = incidentWords(incident, lang);
      const subject = w.emails.incidentSubject.replace("{status}", w.statuses[update.status]).replace("{title}", title);
      const unsubscribe = `${siteUrl()}${platformPath(lang, `/status/unsubscribe/${String(subscriber.unsubscribe_token)}`)}`;
      const email = renderEmail({
        subject,
        preview: updateWords(update, lang).slice(0, 120),
        lang: PLATFORM_LANG_FACTS[lang].tag,
        footer: ["Kaizena Flow · kaizenaflow.com", `${w.emails.unsubscribe}: ${unsubscribe}`],
        blocks: [
          { type: "heading", text: title },
          { type: "paragraph", text: `${w.impacts[incident.impact]} · ${w.statuses[update.status]}` },
          { type: "paragraph", text: updateWords(update, lang) },
          { type: "button", text: w.emails.incidentLink, url: `${siteUrl()}${platformPath(lang, "/status")}` },
        ],
      });
      const outcome = await sendEmail({
        storeId: null,
        kind: "platform.status_incident",
        to: String(subscriber.email),
        email,
        fromName: "Kaizena Flow",
        idempotencyKey: `status-incident:${incidentId}:${incident.updates.length}:${String(subscriber.id)}`,
        headers: { "List-Unsubscribe": `<${unsubscribe}>` },
      });
      if (outcome === "sent" || outcome === "logged") sent++;
    }
  } catch (error) {
    log("error", "status.subscribers_failed", { incidentId }, error);
  }
  return sent;
}

async function listIncidentById(id: string): Promise<IncidentView[]> {
  return (await listIncidents(3650)).filter((i) => i.id === id);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Subscribers
// ---------------------------------------------------------------------------------------------------------------------------------

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const isToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Asks to hear about incidents: a new or unconfirmed address gets a confirmation link (good for a day), a confirmed one nothing more. The
 * answer is the same either way, and an address asks at most three times a day (counted under a hash).
 */
export async function subscribeToStatus(email: string, lang: PlatformLang): Promise<{ ok: boolean }> {
  const address = normaliseEmail(email);
  if (!EMAIL_SHAPE.test(address) || address.length > 254) return { ok: false };
  const bucket = `status:${createHash("sha256").update(`kaizen:status|${address}`).digest("hex").slice(0, 32)}`;
  const [count] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${bucket}, date_trunc('day', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1 returning count
  `);
  if (Number(count?.count ?? 0) > 3) return { ok: true };
  const token = randomBytes(32).toString("base64url");
  const locale = lang === "nb" ? "nb-NO" : "en";
  const [row] = await db().execute<Row>(sql`
    insert into commerce.status_subscribers (email, locale, confirm_hash, unsubscribe_token)
    values (${address}, ${locale}, ${hashOf(token)}, ${randomBytes(32).toString("base64url")})
    on conflict ((lower(email))) do update set confirm_hash = excluded.confirm_hash, locale = excluded.locale, created_at = now()
      where commerce.status_subscribers.confirmed_at is null
    returning id
  `);
  if (!row) return { ok: true };
  const w = platformText(lang).status.emails;
  const url = `${siteUrl()}${platformPath(lang, `/status/confirm/${token}`)}`;
  await sendEmail({
    storeId: null,
    kind: "platform.status_confirm",
    to: address,
    email: renderEmail({
      subject: w.confirmSubject,
      preview: w.confirmBody.slice(0, 120),
      lang: PLATFORM_LANG_FACTS[lang].tag,
      footer: ["Kaizena Flow · kaizenaflow.com"],
      blocks: [
        { type: "heading", text: w.confirmHeading },
        { type: "paragraph", text: w.confirmBody },
        { type: "button", text: w.confirmButton, url },
        { type: "paragraph", text: w.confirmIgnore },
      ],
    }),
    fromName: "Kaizena Flow",
    idempotencyKey: `status-confirm:${String(row.id)}:${token.slice(-12)}`,
  });
  return { ok: true };
}

/** Whether a confirmation link still works (the page shows its button only then). */
export async function confirmationWorks(token: string): Promise<boolean> {
  if (!isToken(token)) return false;
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.status_subscribers
    where confirm_hash = ${hashOf(token)} and created_at > now() - make_interval(hours => ${CONFIRM_HOURS})
  `);
  return Boolean(row);
}

/** The press on the confirmation page: the address now gets incident emails. */
export async function confirmStatusSubscription(token: string): Promise<boolean> {
  if (!isToken(token)) return false;
  const done = await db().execute<Row>(sql`
    update commerce.status_subscribers set confirmed_at = now(), confirm_hash = null
     where confirm_hash = ${hashOf(token)} and created_at > now() - make_interval(hours => ${CONFIRM_HOURS}) returning id
  `);
  return done.length > 0;
}

/** Whether an unsubscribe link names a subscriber. */
export async function unsubscribeWorks(token: string): Promise<boolean> {
  if (!isToken(token)) return false;
  const [row] = await db().execute<Row>(sql`select 1 from commerce.status_subscribers where unsubscribe_token = ${token}`);
  return Boolean(row);
}

/** The press on the unsubscribe page: the row goes. */
export async function unsubscribeFromStatus(token: string): Promise<boolean> {
  if (!isToken(token)) return false;
  const gone = await db().execute<Row>(sql`delete from commerce.status_subscribers where unsubscribe_token = ${token} returning id`);
  return gone.length > 0;
}

/** Confirmed subscribers, counted for the admin. */
export async function subscriberCount(): Promise<number> {
  const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.status_subscribers where confirmed_at is not null`);
  return Number(row?.n ?? 0);
}
