import "server-only";

import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import {
  CHECK_PROBLEMS,
  EMBEDS_MAX,
  dnsFound,
  isHost,
  mayFrame,
  mayRecheck,
  normalizeHost,
  privacyUrlFor,
  RECHECK_MINUTES,
  tagFoundIn,
  type CheckProblem,
} from "@/lib/support-embed";

import { audit } from "./auth";
import { log } from "./log";
import { safeFetch } from "./replicate-fetch";
import { resolveShop, type Shop } from "./shop";
import { getOpenStore } from "./stores";
import { embedDesk, type Desk, type StaffDesk } from "./support-desk";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The sites of an owner's own that show a desk's chat (D581, `docs/support-embed.md` step 1): added, checked and removed from the desk's
 * support settings, and read by the chat's frame (`/embed/chat/{key}/{host}`) and the chat's routes (`chatPlace()`). A site shows the chat
 * once its tag was found on its front page, or its TXT record in DNS (`checkEmbed()`); until then the frame draws nothing and asks for a
 * check when it is opened there, at most every `RECHECK_MINUTES`.
 */

export type SupportEmbed = {
  id: string;
  host: string;
  key: string;
  market: string | null;
  privacyUrl: string | null;
  verifiedAt: string | null;
  verifiedBy: "page" | "dns" | null;
  checkedAt: string | null;
  checkProblem: CheckProblem | null;
  createdAt: string;
};

const EMBED_ROW = z.object({
  id: col.uuid,
  host: col.text,
  key: col.text,
  market: col.textOrNull,
  privacy_url: col.textOrNull,
  verified_at: col.timestampOrNull,
  verified_by: z.enum(["page", "dns"]).nullable(),
  checked_at: col.timestampOrNull,
  check_problem: z.enum(CHECK_PROBLEMS).nullable(),
  created_at: col.timestamp,
});

const COLUMNS = sql`id, host, key, market, privacy_url, verified_at, verified_by, checked_at, check_problem, created_at`;

const toEmbed = (row: z.output<typeof EMBED_ROW>): SupportEmbed => ({
  id: row.id,
  host: row.host,
  key: row.key,
  market: row.market,
  privacyUrl: row.privacy_url,
  verifiedAt: row.verified_at,
  verifiedBy: row.verified_by,
  checkedAt: row.checked_at,
  checkProblem: row.check_problem,
  createdAt: row.created_at,
});

/** The desk's rows: a store's, or Kaizena Flow's (`store_id` null). */
const owned = (storeId: string | null): SQL => (storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`);

/** The desk's sites, oldest first. */
export async function listEmbeds(desk: Desk): Promise<SupportEmbed[]> {
  const rows = await typedRows(EMBED_ROW, sql`select ${COLUMNS} from commerce.support_embeds where ${owned(desk.storeId)} order by created_at, host`);
  return rows.map(toEmbed);
}

/** Why a site could not be added, as the admin words it (`support.embed.problems`). */
export type EmbedProblem = "noAccess" | "host" | "taken" | "max" | "privacy" | "market";

export type AddEmbedResult = { ok: true; embed: SupportEmbed } | { ok: false; problem: EmbedProblem };

/** A new site's key: 20 lower-case letters and digits (about 103 bits), public. */
const newKey = (): string => {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  return [...randomBytes(20)].map((byte) => alphabet[byte % 36]).join("");
};

/**
 * Adds a site to the desk (`support:write`, or a platform admin on Kaizena Flow's): its host from what was typed, its privacy page on the
 * site itself, and for a store the market whose language the chat speaks there (one of `markets`, else the store's first). Its tag is
 * checked at once, so a site that already carries it shows the chat straight away.
 */
export async function addEmbed(
  staff: StaffDesk,
  input: { host: string; privacy?: string; market?: string | null },
  markets: string[] | null,
  deps: CheckDeps = {},
): Promise<AddEmbedResult> {
  if (!staff.canWrite) return { ok: false, problem: "noAccess" };
  const host = normalizeHost(input.host);
  if (!host) return { ok: false, problem: "host" };
  const privacy = privacyUrlFor(host, input.privacy ?? "");
  if (privacy === "invalid") return { ok: false, problem: "privacy" };
  const market = input.market?.trim() || null;
  if (market !== null && (staff.desk.storeId === null || !markets?.includes(market))) return { ok: false, problem: "market" };
  const storeId = staff.desk.storeId;
  const existing = await listEmbeds(staff.desk);
  if (existing.some((embed) => mayFrame(embed.host, host))) return { ok: false, problem: "taken" };
  if (existing.length >= EMBEDS_MAX) return { ok: false, problem: "max" };
  const row = await typedRow(
    EMBED_ROW,
    sql`
      insert into commerce.support_embeds (store_id, host, key, market, privacy_url, created_by)
      values (${storeId}::uuid, ${host}, ${newKey()}, ${market}, ${privacy}, ${staff.account.id}::uuid)
      on conflict do nothing
      returning ${COLUMNS}
    `,
  );
  if (!row) return { ok: false, problem: "taken" };
  await audit(staff.account.id, storeId, "support.embed_added", { host }, { target: { type: "support_embed", id: row.id } });
  const checked = await checkEmbed(staff.desk, row.id, deps);
  return { ok: true, embed: checked ?? toEmbed(row) };
}

/** Removes a site from the desk: its tag stops showing the chat at once. */
export async function removeEmbed(staff: StaffDesk, id: string): Promise<boolean> {
  if (!staff.canWrite || !z.uuid().safeParse(id).success) return false;
  const row = await typedRow(z.object({ host: col.text }), sql`
    delete from commerce.support_embeds where id = ${id}::uuid and ${owned(staff.desk.storeId)} returning host
  `);
  if (!row) return false;
  await audit(staff.account.id, staff.desk.storeId, "support.embed_removed", { host: row.host }, { target: { type: "support_embed", id } });
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
 * Whether the site carries its tag: its front page, read as a browser would ask for it (a redirect within the site followed, never one to
 * another site), holds the loader with the site's key; else, for a tag a tag manager adds, the host's TXT record. Why not, otherwise.
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
 * (the tag can be behind a cookie wall or a moment's outage), until the owner removes it.
 */
export async function checkEmbed(desk: Desk, id: string, deps: CheckDeps = {}): Promise<SupportEmbed | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(EMBED_ROW, sql`select ${COLUMNS} from commerce.support_embeds where id = ${id}::uuid and ${owned(desk.storeId)}`);
  if (!row) return null;
  const result = await findTag(row.host, row.key, deps);
  const found = "found" in result ? result.found : null;
  const problem = "problem" in result ? result.problem : null;
  const updated = await typedRow(
    EMBED_ROW,
    sql`
      update commerce.support_embeds
      set checked_at = now(), updated_at = now(), check_problem = ${problem},
        verified_at = case when ${found}::text is not null then coalesce(verified_at, now()) else verified_at end,
        verified_by = case when ${found}::text is not null then coalesce(verified_by, ${found}) else verified_by end
      where id = ${id}::uuid and ${owned(desk.storeId)}
      returning ${COLUMNS}
    `,
  );
  if (found && !row.verified_at) log("info", "support.embed_verified", { embed: id, by: found });
  return updated ? toEmbed(updated) : null;
}

// The frame ----------------------------------------------------------------------------------------------------------------------------

/** A site as the chat's frame and routes read it: its desk (a store's slug, or Kaizena Flow's), and whether its tag was found. */
export type FrameEmbed = {
  id: string;
  storeId: string | null;
  storeSlug: string | null;
  host: string;
  market: string | null;
  privacyUrl: string | null;
  verified: boolean;
  checkedAt: string | null;
};

const FRAME_ROW = z.object({
  id: col.uuid,
  store_id: col.uuid.nullable(),
  slug: col.textOrNull,
  host: col.text,
  market: col.textOrNull,
  privacy_url: col.textOrNull,
  verified_at: col.timestampOrNull,
  checked_at: col.timestampOrNull,
});

/**
 * The site whose tag carries `key`, when a page on `host` may show its chat (the site's host or its `www.` twin), else null. A store's
 * site is null once the store is gone; whether it is open is the chat's own check (`resolveShop()`).
 */
export async function embedForFrame(key: string, host: string): Promise<FrameEmbed | null> {
  if (!/^[a-z0-9]{20}$/.test(key) || !isHost(host)) return null;
  const row = await typedRow(
    FRAME_ROW,
    sql`
      select e.id, e.store_id, s.slug, e.host, e.market, e.privacy_url, e.verified_at, e.checked_at
      from commerce.support_embeds e left join commerce.stores s on s.id = e.store_id
      where e.key = ${key}
    `,
  );
  if (!row || !mayFrame(row.host, host)) return null;
  if (row.store_id !== null && row.slug === null) return null;
  return {
    id: row.id,
    storeId: row.store_id,
    storeSlug: row.slug,
    host: row.host,
    market: row.market,
    privacyUrl: row.privacy_url,
    verified: row.verified_at !== null,
    checkedAt: row.checked_at,
  };
}

/**
 * A site not yet found, checked again because its frame was opened on it (the tag is there now, or the owner is trying it), at most every
 * `RECHECK_MINUTES`: the time is claimed first, so many visitors at once ask once.
 */
export async function recheckFromFrame(embed: FrameEmbed, deps: CheckDeps = {}): Promise<boolean> {
  if (embed.verified || !mayRecheck(embed.checkedAt)) return embed.verified;
  const claimed = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      update commerce.support_embeds set checked_at = now()
      where id = ${embed.id}::uuid and ${owned(embed.storeId)} and verified_at is null
        and (checked_at is null or checked_at < now() - make_interval(mins => ${RECHECK_MINUTES}))
      returning id
    `,
  );
  if (!claimed) return false;
  const checked = await checkEmbed(embedDesk(embed), embed.id, deps).catch((error: unknown) => {
    log("warn", "support.embed_check_failed", { embed: embed.id }, error);
    return null;
  });
  return checked?.verifiedAt != null;
}

/** A store's site's shop: the store while it is open, in the market the owner chose for the site (else its first); null for Kaizena Flow's. */
export async function embedShop(embed: FrameEmbed): Promise<Shop | null> {
  if (!embed.storeSlug) return null;
  const store = await getOpenStore(embed.storeSlug);
  return store ? resolveShop(store.slug, embed.market ?? store.markets[0]?.slug ?? "") : null;
}
