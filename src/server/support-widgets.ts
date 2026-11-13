import "server-only";

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  CHECK_PROBLEMS,
  EMBED_KEY,
  RECHECK_MINUTES,
  SITES_MAX,
  WIDGET_NAME_MAX,
  WIDGETS_MAX,
  dnsFound,
  isHost,
  mayFrame,
  mayRecheck,
  normalizeHost,
  privacyUrlFor,
  tagFoundIn,
  type CheckProblem,
} from "@/lib/support-embed";
import { readStyle, styleProblem, widgetStyleSchema, type WidgetStyle } from "@/lib/support-widget-style";

import { audit } from "./auth";
import { findFont, installFonts } from "./fonts";
import { log } from "./log";
import { safeFetch } from "./replicate-fetch";
import { resolveShop, type Shop } from "./shop";
import { getOpenStore } from "./stores";
import { embedDesk, type Desk, type StaffDesk } from "./support-desk";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Chat widgets on the owner's own websites (D582, `docs/support-embed.md`): a desk (a store's, or Kaizena Flow's) has any number of
 * widgets, each with its own name, look, language and privacy page and one tag, and each widget any number of sites. A site shows the chat
 * once the widget's tag was found on its front page, or its TXT record in DNS (`checkSite()`); until then the frame draws nothing and asks
 * for a check when it is opened there, at most every `RECHECK_MINUTES`. Read by the chat's frame (`/embed/chat/{key}/{host}`) and routes
 * (`chatPlace()`) through `frameWidget()`.
 */

export type WidgetSite = {
  id: string;
  host: string;
  verifiedAt: string | null;
  verifiedBy: "page" | "dns" | null;
  checkedAt: string | null;
  checkProblem: CheckProblem | null;
};

export type SupportWidget = {
  id: string;
  name: string;
  key: string;
  market: string | null;
  privacyUrl: string | null;
  style: WidgetStyle;
  sites: WidgetSite[];
  createdAt: string;
};

const WIDGET_ROW = z.object({
  id: col.uuid,
  name: col.text,
  key: col.text,
  market: col.textOrNull,
  privacy_url: col.textOrNull,
  style: z.unknown(),
  created_at: col.timestamp,
});

const SITE_ROW = z.object({
  id: col.uuid,
  widget_id: col.uuid,
  host: col.text,
  verified_at: col.timestampOrNull,
  verified_by: z.enum(["page", "dns"]).nullable(),
  checked_at: col.timestampOrNull,
  check_problem: z.enum(CHECK_PROBLEMS).nullable(),
});

const toSite = (row: z.output<typeof SITE_ROW>): WidgetSite => ({
  id: row.id,
  host: row.host,
  verifiedAt: row.verified_at,
  verifiedBy: row.verified_by,
  checkedAt: row.checked_at,
  checkProblem: row.check_problem,
});

const WIDGET_COLUMNS = sql`w.id, w.name, w.key, w.market, w.privacy_url, w.style, w.created_at`;
const SITE_COLUMNS = sql`s.id, s.widget_id, s.host, s.verified_at, s.verified_by, s.checked_at, s.check_problem`;

/** The desk's rows: a store's, or Kaizena Flow's (`store_id` null). */
const owned = (storeId: string | null, column: SQL = sql`store_id`): SQL => (storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`);

/** The desk's widgets with their sites, oldest first. */
export async function listWidgets(desk: Desk): Promise<SupportWidget[]> {
  const [widgets, sites] = await Promise.all([
    typedRows(WIDGET_ROW, sql`select ${WIDGET_COLUMNS} from commerce.support_widgets w where ${owned(desk.storeId, sql`w.store_id`)} order by w.created_at, w.name`),
    typedRows(
      SITE_ROW,
      sql`select ${SITE_COLUMNS} from commerce.support_widget_sites s join commerce.support_widgets w on w.id = s.widget_id
        where ${owned(desk.storeId, sql`w.store_id`)} order by s.created_at, s.host`,
    ),
  ]);
  return widgets.map((row) => ({
    id: row.id,
    name: row.name,
    key: row.key,
    market: row.market,
    privacyUrl: row.privacy_url,
    style: readStyle(row.style),
    sites: sites.filter((site) => site.widget_id === row.id).map(toSite),
    createdAt: row.created_at,
  }));
}

/** One of the desk's widgets, or null. */
export async function getWidget(desk: Desk, id: string): Promise<SupportWidget | null> {
  if (!z.uuid().safeParse(id).success) return null;
  return (await listWidgets(desk)).find((widget) => widget.id === id) ?? null;
}

/** Why a widget or a site could not be saved, as the admin words it (`support.widgets.problems`). */
export type WidgetProblem = "noAccess" | "gone" | "name" | "nameTaken" | "widgetsMax" | "host" | "taken" | "sitesMax" | "privacy" | "market" | "colour" | "css" | "label" | "greeting" | "font";

/** A new widget's key: 20 lower-case letters and digits (about 103 bits), public. */
const newKey = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(20)].map((byte) => alphabet[byte % 36]).join("");
};

const nameOf = (raw: string): string | null => {
  const name = raw.trim().replace(/\s+/g, " ");
  return name && name.length <= WIDGET_NAME_MAX ? name : null;
};

/**
 * Makes a widget on the desk (`support:write`, or a platform admin on Kaizena Flow's), named as the owner tells it apart, in the store's
 * look until it is styled; with a website, that site is added too and checked at once.
 */
export async function createWidget(staff: StaffDesk, input: { name: string; host?: string }, deps: CheckDeps = {}): Promise<{ ok: true; widget: SupportWidget } | { ok: false; problem: WidgetProblem }> {
  if (!staff.canWrite) return { ok: false, problem: "noAccess" };
  const name = nameOf(input.name);
  if (!name) return { ok: false, problem: "name" };
  const host = input.host?.trim() ? normalizeHost(input.host) : null;
  if (input.host?.trim() && !host) return { ok: false, problem: "host" };
  const existing = await listWidgets(staff.desk);
  if (existing.length >= WIDGETS_MAX) return { ok: false, problem: "widgetsMax" };
  if (existing.some((widget) => widget.name.toLowerCase() === name.toLowerCase())) return { ok: false, problem: "nameTaken" };
  if (host && existing.some((widget) => widget.sites.some((site) => mayFrame(site.host, host)))) return { ok: false, problem: "taken" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.support_widgets (store_id, name, key, created_by)
      values (${staff.desk.storeId}::uuid, ${name}, ${newKey()}, ${staff.account.id}::uuid)
      on conflict do nothing
      returning id
    `,
  );
  if (!row) return { ok: false, problem: "nameTaken" };
  await audit(staff.account.id, staff.desk.storeId, "support.widget_added", { name }, { target: { type: "support_widget", id: row.id } });
  if (host) await addSite(staff, row.id, host, deps);
  const widget = await getWidget(staff.desk, row.id);
  return widget ? { ok: true, widget } : { ok: false, problem: "gone" };
}

/**
 * Saves a widget's name, language (one of the store's `markets`), privacy page and look. A font is the caller's to install first
 * (`installFonts()`); colours, words and CSS are checked here, and CSS of the owner's own runs only inside the chat's frame.
 */
export async function saveWidget(
  staff: StaffDesk,
  id: string,
  input: { name: string; market?: string | null; privacy?: string; style: Record<string, unknown> },
  markets: string[] | null,
  deps: { installFont?: (family: string) => Promise<{ ok: true } | { ok: false; problem: string }> } = {},
): Promise<{ ok: true; widget: SupportWidget } | { ok: false; problem: WidgetProblem }> {
  if (!staff.canWrite) return { ok: false, problem: "noAccess" };
  const current = await getWidget(staff.desk, id);
  if (!current) return { ok: false, problem: "gone" };
  const name = nameOf(input.name);
  if (!name) return { ok: false, problem: "name" };
  const privacy = privacyUrlFor(input.privacy ?? "");
  if (privacy === "invalid") return { ok: false, problem: "privacy" };
  const market = input.market?.trim() || null;
  if (market !== null && (staff.desk.storeId === null || !markets?.includes(market))) return { ok: false, problem: "market" };
  const wrong = styleProblem(input.style);
  if (wrong) return { ok: false, problem: wrong };
  const style = widgetStyleSchema.parse(input.style);
  // A new font comes from the catalogue and is copied to Kaizena Flow first (D59), as the theme's are.
  if (style.font && style.font !== current.style.font) {
    if (!findFont(style.font)) return { ok: false, problem: "font" };
    const installed = await (deps.installFont ?? ((family: string) => installFonts([family])))(style.font);
    if (!installed.ok) return { ok: false, problem: "font" };
  }
  const others = await listWidgets(staff.desk);
  if (others.some((widget) => widget.id !== id && widget.name.toLowerCase() === name.toLowerCase())) return { ok: false, problem: "nameTaken" };
  const changed = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      update commerce.support_widgets
      set name = ${name}, market = ${market}, privacy_url = ${privacy}, style = ${JSON.stringify(style)}::jsonb, updated_at = now()
      where id = ${id}::uuid and ${owned(staff.desk.storeId)}
      returning id
    `,
  );
  if (!changed) return { ok: false, problem: "gone" };
  await audit(staff.account.id, staff.desk.storeId, "support.widget_changed", { name }, { target: { type: "support_widget", id } });
  const widget = await getWidget(staff.desk, id);
  return widget ? { ok: true, widget } : { ok: false, problem: "gone" };
}

/** Deletes a widget: its tag stops showing the chat on every one of its sites at once. */
export async function deleteWidget(staff: StaffDesk, id: string): Promise<boolean> {
  if (!staff.canWrite || !z.uuid().safeParse(id).success) return false;
  const row = await typedRow(z.object({ name: col.text }), sql`delete from commerce.support_widgets where id = ${id}::uuid and ${owned(staff.desk.storeId)} returning name`);
  if (!row) return false;
  await audit(staff.account.id, staff.desk.storeId, "support.widget_deleted", { name: row.name }, { target: { type: "support_widget", id } });
  return true;
}

/**
 * Adds a website to one of the desk's widgets and checks it at once, so a site that already carries the tag shows the chat straight away.
 * A site is on one of the desk's widgets at a time: two chats on one page would answer each other's visitors.
 */
export async function addSite(staff: StaffDesk, widgetId: string, rawHost: string, deps: CheckDeps = {}): Promise<{ ok: true; site: WidgetSite } | { ok: false; problem: WidgetProblem }> {
  if (!staff.canWrite) return { ok: false, problem: "noAccess" };
  const host = normalizeHost(rawHost);
  if (!host) return { ok: false, problem: "host" };
  const widgets = await listWidgets(staff.desk);
  const widget = widgets.find((candidate) => candidate.id === widgetId);
  if (!widget) return { ok: false, problem: "gone" };
  if (widgets.some((candidate) => candidate.sites.some((site) => mayFrame(site.host, host)))) return { ok: false, problem: "taken" };
  if (widget.sites.length >= SITES_MAX) return { ok: false, problem: "sitesMax" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.support_widget_sites (widget_id, host)
      select w.id, ${host} from commerce.support_widgets w where w.id = ${widgetId}::uuid and ${owned(staff.desk.storeId, sql`w.store_id`)}
      on conflict do nothing
      returning id
    `,
  );
  if (!row) return { ok: false, problem: "taken" };
  await audit(staff.account.id, staff.desk.storeId, "support.widget_site_added", { host, widget: widget.name }, { target: { type: "support_widget", id: widgetId } });
  const checked = await checkSite(staff.desk, row.id, deps);
  return checked ? { ok: true, site: checked } : { ok: false, problem: "gone" };
}

/** Takes a website off its widget: the tag there stops showing the chat at once. */
export async function removeSite(staff: StaffDesk, siteId: string): Promise<boolean> {
  if (!staff.canWrite || !z.uuid().safeParse(siteId).success) return false;
  const row = await typedRow(
    z.object({ host: col.text, widget_id: col.uuid }),
    sql`
      delete from commerce.support_widget_sites s using commerce.support_widgets w
      where s.id = ${siteId}::uuid and w.id = s.widget_id and ${owned(staff.desk.storeId, sql`w.store_id`)}
      returning s.host, s.widget_id
    `,
  );
  if (!row) return false;
  await audit(staff.account.id, staff.desk.storeId, "support.widget_site_removed", { host: row.host }, { target: { type: "support_widget", id: row.widget_id } });
  return true;
}

// Checking ---------------------------------------------------------------------------------------------------------------------------

/** What a check reads the site with: the page fetcher and DNS (stand-ins in tests). */
export type CheckDeps = {
  fetchPage?: typeof safeFetch;
  txt?: (host: string) => Promise<string[][]>;
};

/** The largest front page read for the tag. */
const PAGE_MAX_BYTES = 2_000_000;

/** A host's TXT records, or none when DNS does not answer in time. */
async function txtRecords(host: string): Promise<string[][]> {
  return Promise.race([resolveTxt(host), new Promise<string[][]>((resolve) => setTimeout(() => resolve([]), 4000))]).catch(() => []);
}

/**
 * Whether a site carries the widget's tag: its front page, read as a browser would ask for it (a redirect within the site followed, never
 * one to another site), holds the loader with the widget's key; else, for a tag a tag manager adds, the host's TXT record. Why not, otherwise.
 */
export async function findTag(host: string, key: string, deps: CheckDeps = {}): Promise<{ found: "page" | "dns" } | { problem: CheckProblem }> {
  if (!isHost(host)) return { problem: "unreachable" };
  const fetched = await (deps.fetchPage ?? safeFetch)(`https://${host}/`, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 8000, maxRedirects: 4, accept: "text/html,application/xhtml+xml" });
  let problem: CheckProblem = "unreachable";
  if (fetched.ok) {
    const landed = (() => {
      try {
        return new URL(fetched.url).hostname;
      } catch {
        return "";
      }
    })();
    if (!mayFrame(host, landed)) problem = "moved";
    else if (tagFoundIn(new TextDecoder().decode(fetched.bytes), key)) return { found: "page" };
    else problem = "not_found";
  }
  const records = await (deps.txt ?? txtRecords)(host);
  if (dnsFound(records, key)) return { found: "dns" };
  return { problem };
}

/**
 * Checks one of the desk's sites now and keeps what was found: a site whose tag is found shows the chat; one found before stays found
 * (the tag can be behind a cookie wall or a moment's outage), until the owner takes it off.
 */
export async function checkSite(desk: Desk, siteId: string, deps: CheckDeps = {}): Promise<WidgetSite | null> {
  if (!z.uuid().safeParse(siteId).success) return null;
  const row = await typedRow(
    SITE_ROW.extend({ key: col.text }),
    sql`select ${SITE_COLUMNS}, w.key from commerce.support_widget_sites s join commerce.support_widgets w on w.id = s.widget_id
      where s.id = ${siteId}::uuid and ${owned(desk.storeId, sql`w.store_id`)}`,
  );
  if (!row) return null;
  const result = await findTag(row.host, row.key, deps);
  const found = "found" in result ? result.found : null;
  const problem = "problem" in result ? result.problem : null;
  const updated = await typedRow(
    SITE_ROW,
    sql`
      update commerce.support_widget_sites s
      set checked_at = now(), check_problem = ${problem},
        verified_at = case when ${found}::text is not null then coalesce(s.verified_at, now()) else s.verified_at end,
        verified_by = case when ${found}::text is not null then coalesce(s.verified_by, ${found}) else s.verified_by end
      from commerce.support_widgets w
      where s.id = ${siteId}::uuid and w.id = s.widget_id and ${owned(desk.storeId, sql`w.store_id`)}
      returning ${SITE_COLUMNS}
    `,
  );
  if (found && !row.verified_at) log("info", "support.widget_site_verified", { site: siteId, by: found });
  return updated ? toSite(updated) : null;
}

// The frame ----------------------------------------------------------------------------------------------------------------------------

/** A widget on one of its sites, as the chat's frame and routes read it. */
export type FrameWidget = {
  id: string;
  storeId: string | null;
  storeSlug: string | null;
  siteId: string;
  /** The site's host as the owner added it. */
  host: string;
  market: string | null;
  privacyUrl: string | null;
  style: WidgetStyle;
  verified: boolean;
  checkedAt: string | null;
};

const FRAME_ROW = z.object({
  id: col.uuid,
  store_id: col.uuid.nullable(),
  slug: col.textOrNull,
  market: col.textOrNull,
  privacy_url: col.textOrNull,
  style: z.unknown(),
  site_id: col.uuid,
  host: col.text,
  verified_at: col.timestampOrNull,
  checked_at: col.timestampOrNull,
});

/**
 * The widget whose tag carries `key`, on the site a page on `host` belongs to (the site's host or its `www.` twin), else null. A store's
 * widget is null once the store is gone; whether it is open is the chat's own check (`resolveShop()`).
 */
export async function frameWidget(key: string, host: string): Promise<FrameWidget | null> {
  if (!EMBED_KEY.test(key) || !isHost(host)) return null;
  const rows = await typedRows(
    FRAME_ROW,
    sql`
      select w.id, w.store_id, st.slug, w.market, w.privacy_url, w.style, s.id as site_id, s.host, s.verified_at, s.checked_at
      from commerce.support_widgets w
      join commerce.support_widget_sites s on s.widget_id = w.id
      left join commerce.stores st on st.id = w.store_id
      where w.key = ${key}
    `,
  );
  const row = rows.find((candidate) => mayFrame(candidate.host, host));
  if (!row || (row.store_id !== null && row.slug === null)) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    storeSlug: row.slug,
    siteId: row.site_id,
    host: row.host,
    market: row.market,
    privacyUrl: row.privacy_url,
    style: readStyle(row.style),
    verified: row.verified_at !== null,
    checkedAt: row.checked_at,
  };
}

/**
 * A site not yet found, checked again because the widget's frame was opened on it (the tag is there now, or the owner is trying it), at
 * most every `RECHECK_MINUTES`: the time is claimed first, so many visitors at once ask once.
 */
export async function recheckFromFrame(frame: FrameWidget, deps: CheckDeps = {}): Promise<boolean> {
  if (frame.verified || !mayRecheck(frame.checkedAt)) return frame.verified;
  const claimed = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      update commerce.support_widget_sites s set checked_at = now()
      from commerce.support_widgets w
      where s.id = ${frame.siteId}::uuid and w.id = s.widget_id and ${owned(frame.storeId, sql`w.store_id`)} and s.verified_at is null
        and (s.checked_at is null or s.checked_at < now() - make_interval(mins => ${RECHECK_MINUTES}))
      returning s.id
    `,
  );
  if (!claimed) return false;
  const checked = await checkSite(embedDesk(frame), frame.siteId, deps).catch((error: unknown) => {
    log("warn", "support.widget_check_failed", { site: frame.siteId }, error);
    return null;
  });
  return checked?.verifiedAt != null;
}

/** A store's widget's shop: the store while it is open, in the market chosen for the widget (else its first); null for Kaizena Flow's. */
export async function widgetShop(frame: Pick<FrameWidget, "storeSlug" | "market">): Promise<Shop | null> {
  if (!frame.storeSlug) return null;
  const store = await getOpenStore(frame.storeSlug);
  return store ? resolveShop(store.slug, frame.market ?? store.markets[0]?.slug ?? "") : null;
}
