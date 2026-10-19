import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";

import { audit } from "./auth";
import { CHARGE_CHANGED, isChargeRefusal, setThemeCharge } from "./theme-prices";
import { checkStoreTheme } from "./themes";

/**
 * The themes installed in a store (theme store phase 1, D241, `docs/theme-phase-1.md`): several, one live. The live install's look is the
 * store's own columns (`stores.theme`, `custom_css`, `header_id`, `footer_id`, `product_layout_id`), which every page reads as it always did;
 * an install that is not live keeps its look in its row until it is switched to. Switching swaps the two in one transaction, so what visitors
 * see changes at once and nothing else does: no page, product, menu, word or picture is touched, and the layout pages an install chose stay
 * in the store's page library whichever is live. This module and `applyDesignPreset()` are the only writers of `store_theme_installs`
 * (`theme-installs.scan.test.ts`).
 */

type Row = Record<string, unknown>;
type Tx = Pick<ReturnType<typeof db>, "execute">;

/** Which of these stores already have a theme installed, for *Try it in your store* (`docs/theme-phase-3.md` step 2). */
export async function storesWithTheme(presetId: string, storeSlugs: readonly string[]): Promise<Set<string>> {
  if (storeSlugs.length === 0) return new Set();
  const rows = await db().execute<Row>(sql`
    select distinct s.slug from commerce.store_theme_installs i join commerce.stores s on s.id = i.store_id
    where i.preset_id = ${presetId}::uuid and s.slug = any(${`{${storeSlugs.map((slug) => JSON.stringify(slug)).join(",")}}`}::text[])
  `);
  return new Set(rows.map((row) => String(row.slug)));
}

/** The look an install keeps while it is not live: the store's look columns as they were. */
export type InstalledLook = { theme: unknown; css: string; headerId: string | null; footerId: string | null; productLayoutId: string | null };

export type ThemeInstall = {
  id: string;
  title: string;
  /** The theme it came from; null: *Custom*, the store's own look. */
  presetId: string | null;
  /** The version installed, when it came from a published theme. */
  version: number | null;
  live: boolean;
  installedAt: string;
  switchedAt: string | null;
};

export type InstallResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; problems: string[] };

/** At most this many themes installed in a store; removing one makes room. */
export const INSTALLS_MAX = 20;

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const refuse = (message: string): { ok: false; problems: string[] } => ({ ok: false, problems: [message] });
const UNKNOWN = "That theme is not installed in this store.";
export const INSTALLS_FULL = `This store has ${INSTALLS_MAX} themes installed. Remove one from its theme library first.`;

class Refused extends Error {}

/** The store's installed themes, the live one first, then the newest. */
export async function listInstalls(storeId: string): Promise<ThemeInstall[]> {
  if (!isUuid(storeId)) return [];
  const rows = await db().execute<Row>(sql`
    select i.id, i.title, i.preset_id, i.live, i.installed_at, i.switched_at, v.number as version
    from commerce.store_theme_installs i
    left join commerce.design_preset_versions v on v.id = i.version_id
    where i.store_id = ${storeId}::uuid
    order by i.live desc, coalesce(i.switched_at, i.installed_at) desc, i.id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    presetId: row.preset_id ? String(row.preset_id) : null,
    version: row.version === null || row.version === undefined ? null : Number(row.version),
    live: row.live === true,
    installedAt: new Date(String(row.installed_at)).toISOString(),
    switchedAt: row.switched_at ? new Date(String(row.switched_at)).toISOString() : null,
  }));
}

/** The store's look as visitors see it now, with the install it belongs to: the one reader of the look as a whole (phase 2 grows it). */
export async function liveLook(storeId: string): Promise<(InstalledLook & { installId: string | null; title: string }) | null> {
  if (!isUuid(storeId)) return null;
  const [row] = await db().execute<Row>(sql`
    select s.theme, s.custom_css, s.header_id, s.footer_id, s.product_layout_id, i.id as install_id, i.title
    from commerce.stores s
    left join commerce.store_theme_installs i on i.store_id = s.id and i.live
    where s.id = ${storeId}::uuid
  `);
  if (!row) return null;
  return { ...lookOf(row), installId: row.install_id ? String(row.install_id) : null, title: row.title ? String(row.title) : "Custom" };
}

const lookOf = (row: Row): InstalledLook => ({
  theme: row.theme ?? {},
  css: String(row.custom_css ?? ""),
  headerId: row.header_id ? String(row.header_id) : null,
  footerId: row.footer_id ? String(row.footer_id) : null,
  productLayoutId: row.product_layout_id ? String(row.product_layout_id) : null,
});

/** How many themes the store has installed. */
export async function installCount(storeId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.store_theme_installs where store_id = ${storeId}::uuid`);
  return Number(row?.n ?? 0);
}

/**
 * Inside a transaction that holds the store's row (`for update`): the live install is put away with the store's look as it is now, and its
 * id and title returned. A store that somehow has no live install gets one (*Custom*) put away the same way.
 */
export async function putAwayLive(tx: Tx, storeId: string): Promise<{ id: string; title: string }> {
  const [store] = await tx.execute<Row>(sql`
    select theme, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${storeId}::uuid
  `);
  if (!store) throw new Refused("That store no longer exists.");
  const look = JSON.stringify(lookOf(store));
  const [put] = await tx.execute<Row>(sql`
    update commerce.store_theme_installs set live = false, look = ${look}::jsonb, switched_at = now()
    where store_id = ${storeId}::uuid and live
    returning id, title
  `);
  if (put) return { id: String(put.id), title: String(put.title) };
  const [made] = await tx.execute<Row>(sql`
    insert into commerce.store_theme_installs (store_id, title, look, switched_at) values (${storeId}::uuid, 'Custom', ${look}::jsonb, now())
    returning id, title
  `);
  return { id: String(made.id), title: String(made.title) };
}

/**
 * Inside the same transaction: writes a kept look into the store's columns, checked again as it goes in: a layout page only while it is still
 * the store's, of its kind and published (else the standard one), the saved theme it names only while it exists (D60), the CSS only while
 * `cssProblem()` passes it. Returns what was left out, for the person.
 */
async function writeLook(tx: Tx, storeId: string, kept: unknown): Promise<string[]> {
  const look = (kept && typeof kept === "object" ? kept : {}) as Partial<InstalledLook>;
  const notes: string[] = [];
  const live = async (id: unknown, type: string, name: string) => {
    if (typeof id !== "string" || !isUuid(id)) return null;
    const [page] = await tx.execute<Row>(sql`
      select id from commerce.pages where store_id = ${storeId}::uuid and id = ${id}::uuid and type = ${type} and published_at is not null
    `);
    if (!page) notes.push(`Its ${name} is no longer published, so the standard one is shown.`);
    return page ? id : null;
  };
  const theme = (look.theme && typeof look.theme === "object" ? { ...(look.theme as Record<string, unknown>) } : {}) as Record<string, unknown>;
  if (typeof theme.savedId === "string") {
    const [saved] = isUuid(theme.savedId)
      ? await tx.execute<Row>(sql`select 1 from commerce.store_themes where id = ${theme.savedId}::uuid and store_id = ${storeId}::uuid`)
      : [];
    if (!saved) theme.savedId = null;
  }
  const css = typeof look.css === "string" && cssProblem(look.css) === null ? look.css : "";
  if (typeof look.css === "string" && look.css !== css) notes.push("Its own CSS could not be used and was left out.");
  await tx.execute(sql`
    update commerce.stores set theme = ${JSON.stringify(theme)}::jsonb, custom_css = ${css},
      header_id = ${await live(look.headerId, "header", "header")}::uuid,
      footer_id = ${await live(look.footerId, "footer", "footer")}::uuid,
      product_layout_id = ${await live(look.productLayoutId, "product_layout", "product layout")}::uuid
    where id = ${storeId}::uuid
  `);
  return notes;
}

/**
 * Inside a transaction holding the store's row: makes an installed theme that is not live the live one, after `putAwayLive()` (which the
 * caller does first, so the store's look is kept before it is replaced). Its kept look goes into the store's columns.
 */
export async function makeLive(tx: Tx, storeId: string, installId: string): Promise<{ title: string; notes: string[] }> {
  const [install] = await tx.execute<Row>(sql`
    select id, title, look, live from commerce.store_theme_installs where id = ${installId}::uuid and store_id = ${storeId}::uuid for update
  `);
  if (!install) throw new Refused(UNKNOWN);
  if (install.live) throw new Refused("That theme is live already.");
  // The look first: putting the row live clears its kept look.
  const notes = await writeLook(tx, storeId, install.look);
  await tx.execute(sql`update commerce.store_theme_installs set live = true, look = null, switched_at = now() where id = ${installId}::uuid`);
  return { title: String(install.title), notes };
}

/** Who may change a store's look: a platform admin, or someone who works in it (the caller checked their permission); never a store the platform keeps. */
export async function lookChangeRefusal(storeId: string, accountId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select s.status, not (s.starter and not exists (select 1 from commerce.store_starters hs where hs.store_id = s.id)) as workable,
      (select a.platform_admin and a.disabled_at is null from commerce.accounts a where a.id = ${accountId}::uuid) as platform_admin,
      exists (
        select 1 from commerce.store_members m
        where m.store_id = s.id and m.account_id = ${accountId}::uuid and m.disabled_at is null and (m.expires_at is null or m.expires_at > now())
      ) as member
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  if (!row) return "That store no longer exists.";
  if (!row.platform_admin && !row.member) return "You do not work in this store.";
  if (row.status !== "active") return "The store is not open, so its look cannot be changed.";
  if (!row.workable) return "This store is kept by the platform: its look is not changed here.";
  return null;
}

/**
 * Switches the store to one of its installed themes (D241): the live one is put away with the look as it is now (every change made to it
 * kept), the chosen one becomes live. One transaction; the caller refreshes `designTags()`. Words, pictures, pages, products and menus are
 * never touched.
 */
export async function switchToInstall(
  storeId: string,
  installId: string,
  accountId: string,
  /** The price the person agreed to for a premium theme the store does not have yet (D286, `chargeToken()`). */
  charge: string | null = null,
): Promise<InstallResult<{ title: string; from: string; notes: string[] }>> {
  if (!isUuid(storeId) || !isUuid(installId) || !isUuid(accountId)) return refuse(UNKNOWN);
  const refusal = await lookChangeRefusal(storeId, accountId);
  if (refusal) return refuse(refusal);
  let done: { title: string; from: string; fromId: string; notes: string[] };
  try {
    done = await db().transaction(async (tx) => {
      const [store] = await tx.execute<Row>(sql`select status from commerce.stores where id = ${storeId}::uuid for update`);
      if (!store || store.status !== "active") throw new Refused("The store is not open, so its look cannot be changed.");
      const [target] = await tx.execute<Row>(sql`
        select live from commerce.store_theme_installs where id = ${installId}::uuid and store_id = ${storeId}::uuid
      `);
      if (!target) throw new Refused(UNKNOWN);
      if (target.live) throw new Refused("That theme is live already.");
      await setThemeCharge(tx, accountId, charge);
      const from = await putAwayLive(tx, storeId);
      const made = await makeLive(tx, storeId, installId);
      return { title: made.title, from: from.title, fromId: from.id, notes: made.notes };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    console.error("[theme-installs] switching failed", error);
    return refuse(switchProblem(error));
  }
  await audit(accountId, storeId, "store.theme_switched", { install: installId, title: done.title, from: done.fromId }, {
    area: "website",
    target: { type: "theme_install", id: installId },
  });
  return { ok: true, title: done.title, from: done.from, notes: done.notes };
}

/** The words for a refusal of the database's rules while switching. */
function switchProblem(error: unknown): string {
  if (isChargeRefusal(error)) return CHARGE_CHANGED;
  const text = error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? "")}` : String(error);
  if (/stores?_experiment|experiment/i.test(text)) return "A running A/B test uses this store's header or footer. Stop it before switching themes.";
  return "The theme could not be switched. Nothing was changed; try again.";
}

/** Removes an installed theme that is not live (D241). The layout pages it chose stay in the store's page library. */
export async function removeInstall(storeId: string, installId: string, accountId: string): Promise<InstallResult<{ title: string }>> {
  if (!isUuid(storeId) || !isUuid(installId) || !isUuid(accountId)) return refuse(UNKNOWN);
  const refusal = await lookChangeRefusal(storeId, accountId);
  if (refusal) return refuse(refusal);
  const [row] = await db().execute<Row>(sql`
    delete from commerce.store_theme_installs where id = ${installId}::uuid and store_id = ${storeId}::uuid and not live
    returning title, preset_id
  `);
  if (!row) return refuse("Only a theme that is not live can be removed.");
  await audit(accountId, storeId, "store.theme_removed", { install: installId, title: String(row.title), preset: row.preset_id ?? null }, {
    area: "website",
    target: { type: "theme_install", id: installId },
  });
  return { ok: true, title: String(row.title) };
}

/** One installed theme with its look: a live one's is the store's columns, any other's the look it keeps (D244). */
export type InstallWithLook = Omit<ThemeInstall, "installedAt" | "switchedAt"> & { look: InstalledLook };

export async function installLook(storeId: string, installId: string): Promise<InstallWithLook | null> {
  if (!isUuid(storeId) || !isUuid(installId)) return null;
  const [row] = await db().execute<Row>(sql`
    select i.id, i.title, i.preset_id, i.live, i.look, v.number as version,
      s.theme, s.custom_css, s.header_id, s.footer_id, s.product_layout_id
    from commerce.store_theme_installs i
    join commerce.stores s on s.id = i.store_id
    left join commerce.design_preset_versions v on v.id = i.version_id
    where i.id = ${installId}::uuid and i.store_id = ${storeId}::uuid
  `);
  if (!row) return null;
  const kept = (row.look && typeof row.look === "object" ? row.look : {}) as Row;
  const look = row.live
    ? lookOf(row)
    : lookOf({ theme: kept.theme, custom_css: kept.css, header_id: kept.headerId, footer_id: kept.footerId, product_layout_id: kept.productLayoutId });
  return {
    id: String(row.id),
    title: String(row.title),
    presetId: row.preset_id ? String(row.preset_id) : null,
    version: row.version === null || row.version === undefined ? null : Number(row.version),
    live: row.live === true,
    look,
  };
}

/**
 * Changes the look an installed theme that is not live keeps (D244, `docs/theme-phase-2.md` step 3): its theme settings (checked as the live
 * theme's are, `checkStoreTheme()`) or its own CSS (`cssProblem()`). Visitors see nothing of it until the owner switches to it; the live theme
 * is edited where it always was. Audited `store.theme_customised`.
 */
export async function saveInstallLook(
  storeId: string,
  installId: string,
  accountId: string,
  change: { theme: unknown } | { css: string },
): Promise<InstallResult<{ theme?: unknown; css?: string }>> {
  if (!isUuid(storeId) || !isUuid(installId) || !isUuid(accountId)) return refuse(UNKNOWN);
  const refusal = await lookChangeRefusal(storeId, accountId);
  if (refusal) return refuse(refusal);
  let patch: Record<string, unknown>;
  if ("theme" in change) {
    const checked = await checkStoreTheme(storeId, change.theme);
    if (!checked.ok) return checked;
    patch = { theme: checked.theme };
  } else {
    const css = typeof change.css === "string" ? change.css : "";
    const problem = cssProblem(css);
    if (problem) return refuse(problem);
    patch = { css };
  }
  const [row] = await db().execute<Row>(sql`
    update commerce.store_theme_installs set look = coalesce(look, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
    where id = ${installId}::uuid and store_id = ${storeId}::uuid and not live
    returning title
  `);
  if (!row) {
    const [exists] = await db().execute<Row>(sql`select live from commerce.store_theme_installs where id = ${installId}::uuid and store_id = ${storeId}::uuid`);
    return refuse(exists ? "This theme is live: change it in Design settings, where its changes reach visitors at once." : UNKNOWN);
  }
  await audit(accountId, storeId, "store.theme_customised", { install: installId, title: String(row.title), changed: Object.keys(patch) }, {
    area: "website",
    target: { type: "theme_install", id: installId },
  });
  return { ok: true, ...patch };
}

/** Whether an installed theme takes new versions of its theme by itself (D245); on until the owner switches it off. */
export async function setFollowsUpdates(storeId: string, installId: string, accountId: string, follows: boolean): Promise<InstallResult<{ title: string }>> {
  if (!isUuid(storeId) || !isUuid(installId) || !isUuid(accountId)) return refuse(UNKNOWN);
  const refusal = await lookChangeRefusal(storeId, accountId);
  if (refusal) return refuse(refusal);
  const [row] = await db().execute<Row>(sql`
    update commerce.store_theme_installs set follows_updates = ${follows}
    where id = ${installId}::uuid and store_id = ${storeId}::uuid and preset_id is not null
    returning title
  `);
  if (!row) return refuse(UNKNOWN);
  await audit(accountId, storeId, "store.theme_follows_updates", { install: installId, follows }, { area: "website", target: { type: "theme_install", id: installId } });
  return { ok: true, title: String(row.title) };
}

/** Thrown inside a transaction for a refusal the person reads; the callers in `design-presets.ts` share it. */
export { Refused as InstallRefused };
