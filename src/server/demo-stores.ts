import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { parseDesignSnapshot, type DesignDetails } from "@/lib/design-presets";
import { variationsOf } from "@/lib/design-variations";
import { demoStoreAddress, presetRefusal, type DemoDetails, type LiveDemo, type LookPart } from "@/lib/demo-stores";
import { slugProblem } from "@/lib/slug";
import { starterRefusal, type StarterRow } from "@/lib/store-starters";
import { parseStoreTheme } from "@/lib/theme";

import { audit, type Account } from "./auth";
import { addVariation } from "./design-variations";
import { applyDesignPreset, copyStoreLookToDraft, createDesign, liveLookChanges, type ApplyDeps } from "./design-presets";
import { STARTERS_TAG, getStarter, giveThemeContent, joinStarter, type StarterResult } from "./store-starters";

/**
 * Demo stores (D277, `docs/themes-content-and-demo-stores.md` section 4): live stores a platform admin makes from starting content, dressed
 * in a theme or preset and customised like any store. Each is a store template of kind `demo` (`store_starters.kind`): a starter store,
 * so it takes no orders, holds back shopper emails and is `noindex` (D175), and it is published as it stands, never frozen (the database
 * refuses, `freeze_starter()`), never a new store's content (`starter_offered_source()` leaves it out). The theme it wears is the live
 * install of its theme library, so the theme's page lists it under *See it live* (`liveDemosOf()`) with nothing chosen on the theme. Its
 * look reaches the theme store only by a copy made once (*Publish this look…*): a new theme, a preset of the theme it wears, or that theme's
 * next version. Unpublish, archive, restore and delete are the store templates' (`store-starters.ts`).
 */

type Row = Record<string, unknown>;

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const refuse = (message: string): { ok: false; problems: string[] } => ({ ok: false, problems: [message] });
const UNKNOWN = "Unknown demo store.";
const NOT_YOURS = "Only Kaizena Flow's admins make demo stores.";

class Refused extends Error {}

/** A demo store for the platform admin: its row, its store's name and the look it wears now. */
export type DemoStore = StarterRow & {
  /** The theme it wears (its live install), with its preset; null: none (its own look, *Custom*). */
  wears: { presetId: string; title: string; variation: string | null; presetName: string | null; archived: boolean; launch: boolean } | null;
  address: string;
};

const WEARS = sql`
  select i.store_id, i.variation, p.id as preset_id, p.title, p.snapshot, p.archived_at, p.launch_key
  from commerce.store_theme_installs i join commerce.design_presets p on p.id = i.preset_id
  where i.live
`;

function wearsOf(row: Row | undefined): DemoStore["wears"] {
  if (!row) return null;
  const variation = row.variation ? String(row.variation) : null;
  const snapshot = parseDesignSnapshot(row.snapshot);
  const preset = variation && snapshot ? variationsOf(snapshot).find((v) => v.key === variation) : undefined;
  return {
    presetId: String(row.preset_id),
    title: String(row.title),
    variation,
    presetName: preset?.name ?? null,
    archived: Boolean(row.archived_at),
    launch: Boolean(row.launch_key),
  };
}

/** The demo stores, the current ones (published or not) or the archived ones, newest last, each with the look it wears. */
export async function listDemoStores(filter: "current" | "archived" = "current"): Promise<DemoStore[]> {
  const rows = await db().execute<Row>(sql`
    select st.id from commerce.store_starters st
    where st.kind = 'demo' and ${filter === "archived" ? sql`st.archived_at is not null` : sql`st.archived_at is null`}
    order by st.position, lower(st.title), st.id
  `);
  const found = await Promise.all(rows.map((row) => getDemoStore(String(row.id))));
  return found.filter((demo): demo is DemoStore => demo !== null);
}

/** One demo store, or null when there is none (or the template is starting content). */
export async function getDemoStore(id: string): Promise<DemoStore | null> {
  const starter = await getStarter(id);
  if (!starter || starter.kind !== "demo") return null;
  const [wears] = await db().execute<Row>(sql`${WEARS} and i.store_id = ${starter.storeId}::uuid`);
  return { ...starter, wears: wearsOf(wears), address: demoStoreAddress(starter.storeSlug) };
}

/** What a demo store may start with: published starting content and themes' content, never another demo store. */
export async function demoContentChoices(): Promise<{ id: string; title: string; kind: "pack" | "theme" | "template" }[]> {
  const rows = await db().execute<Row>(sql`
    select st.id, s.name, st.pack_key, p.title as theme_title from commerce.store_starters st
      join commerce.stores s on s.id = coalesce(st.published_store_id, st.store_id) and s.starter and s.status = 'active'
      left join commerce.design_presets p on p.id = st.design_preset_id
     where st.kind = 'content' and st.published and st.archived_at is null
     order by st.pack_key is null, st.design_preset_id is null, st.position, lower(s.name)
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: row.theme_title ? `${String(row.name)}, ${String(row.theme_title)}'s content` : String(row.name),
    kind: row.pack_key ? "pack" : row.theme_title ? "theme" : "template",
  }));
}

/**
 * Makes a demo store (D277): a copy of published starting content (`clone_store(starter_source(content))`, the admin its owner), marked a
 * starter and described as a demo store, unpublished, in one transaction; then dressed in the theme or preset chosen
 * (`applyDesignPreset()`). The store stays when the theme cannot be applied, with its content's look, and the note says so. The address is
 * a store's (real stores share it), checked as any new store's is.
 */
export async function createDemoStore(
  admin: Account,
  input: { name: string; slug: string; look: { id: string; variation: string | null }; contentId: string },
  deps: ApplyDeps = {},
): Promise<StarterResult<{ id: string; slug: string; themed: boolean; notes: string[] }>> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) return refuse("Give the demo store a name.");
  if (name.length > 80) return refuse("Keep the name under 81 characters.");
  const problem = slugProblem(input.slug);
  if (problem) return refuse(`Address: ${problem}`);
  if (!isUuid(input.look.id)) return refuse("Choose the theme it wears.");
  if (!isUuid(input.contentId)) return refuse("Choose the content it starts with.");
  const [taken] = await db().execute<Row>(sql`select 1 as taken from commerce.stores where slug = ${input.slug}`);
  if (taken) return refuse(`The address ${input.slug} is taken. Choose another.`);
  // The theme it wears: published and not archived, and the preset one its published version has.
  const [theme] = await db().execute<Row>(sql`select snapshot from commerce.design_presets where id = ${input.look.id}::uuid and published and archived_at is null`);
  const snapshot = theme ? parseDesignSnapshot(theme.snapshot) : null;
  if (!snapshot) return refuse("That theme is not published. Choose a published theme.");
  if (input.look.variation && !variationsOf(snapshot).some((v) => v.key === input.look.variation)) return refuse("That preset is not in the theme's published version.");

  let made: { id: string; storeId: string };
  try {
    made = await db().transaction(async (tx) => {
      const [source] = await tx.execute<Row>(sql`
        select st.category from commerce.store_starters st where st.id = ${input.contentId}::uuid and st.kind = 'content'
      `);
      if (!source) throw new Refused("Choose published content to start with.");
      const [store] = await tx.execute<Row>(sql`
        select commerce.clone_store(commerce.starter_source(${input.contentId}::uuid), ${input.slug}, ${name}, ${admin.id}::uuid) as id
      `);
      const storeId = String(store.id);
      await tx.execute(sql`update commerce.stores set starter = true where id = ${storeId}::uuid`);
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.store_starters (store_id, kind, title, category, position, published, created_by, updated_by)
        values (${storeId}::uuid, 'demo', ${name}, ${String(source.category)},
          (select coalesce(max(position), 0) + 1 from commerce.store_starters), false, ${admin.id}::uuid, ${admin.id}::uuid)
        returning id
      `);
      return { id: String(row.id), storeId };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    const text = describe(error);
    if (text.includes("stores_slug_unique")) return refuse(`The address ${input.slug} is taken. Choose another.`);
    console.error("[demo-stores] making a demo store failed", error);
    return refuse(starterRefusal(text) ?? "The demo store could not be made. Nothing was changed; try again.");
  }
  await audit(admin.id, made.storeId, "platform.demo_store_created", { starter: made.id, slug: input.slug, preset: input.look.id, variation: input.look.variation, content: input.contentId }, {
    target: { type: "store_starter", id: made.id },
  });
  const notes: string[] = [];
  const applied = await applyDesignPreset(made.storeId, input.look.id, admin.id, deps, input.look.variation);
  if (applied.ok) notes.push(...applied.notes);
  else notes.push(`The demo store is made, but the theme could not be applied (${applied.problems.join(" ")}). Choose it in its Design settings.`);
  return { ok: true, id: made.id, slug: input.slug, themed: applied.ok, notes };
}

function describe(error: unknown): string {
  const parts: string[] = [];
  for (let e: unknown = error; e && parts.length < 5; e = (e as { cause?: unknown }).cause) {
    const record = e as { message?: unknown; constraint_name?: unknown; constraint?: unknown };
    if (typeof record.message === "string") parts.push(record.message);
    if (typeof record.constraint_name === "string") parts.push(record.constraint_name);
    if (typeof record.constraint === "string") parts.push(record.constraint);
  }
  return parts.join(" ");
}

/**
 * Publishes a demo store (D277): live as it stands, from now on as a real store is, every change showing at once; nothing is frozen. It
 * appears under *See it live* on the theme it wears. Refused while archived or while its store is not open.
 */
export async function publishDemoStore(admin: Account, id: string): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const [row] = await db().execute<Row>(sql`
    update commerce.store_starters st set published = true, published_at = now(), draft = null, updated_by = ${admin.id}::uuid
      from commerce.stores s
     where st.id = ${id}::uuid and st.kind = 'demo' and st.archived_at is null and s.id = st.store_id and s.starter and s.status = 'active'
    returning st.store_id
  `);
  if (!row) {
    const demo = await getDemoStore(id);
    if (!demo) return refuse(UNKNOWN);
    return refuse(demo.archivedAt ? "This demo store is archived. Restore it before publishing it." : "Its store is not open, so it cannot be published.");
  }
  await audit(admin.id, String(row.store_id), "platform.demo_store_published", { starter: id }, { target: { type: "store_starter", id } });
  return { ok: true };
}

/** Saves a demo store's details (D277): its trade and its picture for *See it live*, shown at once (it is live, nothing waits for Publish). */
export async function saveDemoDetails(admin: Account, id: string, details: DemoDetails): Promise<StarterResult> {
  if (!admin.platformAdmin || !isUuid(id)) return refuse(UNKNOWN);
  const [row] = await db().execute<Row>(sql`
    update commerce.store_starters set summary = ${details.trade}, picture_url = ${details.pictureUrl}, updated_by = ${admin.id}::uuid
     where id = ${id}::uuid and kind = 'demo'
    returning store_id
  `);
  if (!row) return refuse(UNKNOWN);
  await audit(admin.id, String(row.store_id), "platform.demo_store_updated", { starter: id }, { target: { type: "store_starter", id } });
  return { ok: true };
}

/**
 * The published demo stores wearing one of a theme's looks, for *See it live* on its page in the theme store (D277): published, not
 * archived, their store open, and the theme their live install. Cached a few minutes under `STARTERS_TAG` (publishing refreshes it at once;
 * a demo store that switches theme shows within minutes).
 */
export async function liveDemosOf(presetId: string): Promise<LiveDemo[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag(STARTERS_TAG);
  if (!isUuid(presetId)) return [];
  const rows = await readDb().execute<Row>(sql`
    select st.id, st.summary, st.picture_url, s.slug, s.name, i.variation
      from commerce.store_starters st
      join commerce.stores s on s.id = st.store_id and s.starter and s.status = 'active'
      join commerce.store_theme_installs i on i.store_id = s.id and i.live
     where st.kind = 'demo' and st.published and st.archived_at is null and i.preset_id = ${presetId}::uuid
     order by st.position, lower(s.name), st.id
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    trade: String(row.summary ?? ""),
    pictureUrl: row.picture_url ? String(row.picture_url) : null,
    variation: row.variation ? String(row.variation) : null,
    href: demoStoreAddress(String(row.slug)),
  }));
}

/* ------------------------------------------------------------------------------------------------------------------------------------------
 * Publish this look… (D277): a copy made once; the demo store and the theme never stay linked.
 * ---------------------------------------------------------------------------------------------------------------------------------------- */

/** The demo store, with the admin made an owner of it first (as opening its admin does), so its look can be read as a store they work in. */
async function joined(admin: Account, id: string): Promise<{ ok: true; demo: DemoStore } | { ok: false; problems: string[] }> {
  const demo = await getDemoStore(id);
  if (!demo) return refuse(UNKNOWN);
  if (demo.archivedAt) return refuse("This demo store is archived. Restore it first.");
  const join = await joinStarter(admin, id);
  if (!join.ok) return join;
  return { ok: true, demo };
}

/**
 * *As a new theme*: a theme whose look is the demo store's now (theme settings, header, footer, product page, CSS: `createDesign()` from
 * the store) and whose content is a copy of the demo store's (`giveThemeContent()`), unpublished, to be named and published like any theme.
 * The theme stays when its content cannot be copied, and the note says so.
 */
export async function demoLookAsTheme(admin: Account, id: string, details: DesignDetails, deps: ApplyDeps = {}): Promise<StarterResult<{ presetId: string; notes: string[] }>> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const ready = await joined(admin, id);
  if (!ready.ok) return ready;
  const made = await createDesign(admin, { origin: { kind: "store", storeId: ready.demo.storeId }, details }, deps);
  if (!made.ok) return made;
  const notes = [...made.notes];
  const content = await giveThemeContent(admin, made.id, id);
  if (!content.ok) notes.push(`Its content could not be copied (${content.problems.join(" ")}). Choose it on the theme's Content tab.`);
  await audit(admin.id, ready.demo.storeId, "platform.demo_look_published", { starter: id, as: "theme", preset: made.id }, { target: { type: "design_preset", id: made.id } });
  return { ok: true, presetId: made.id, notes };
}

/**
 * Whether the demo store's look can be a preset of the theme it wears, and why not: a preset holds the theme settings only, so the header,
 * footer, product page and CSS must be as the theme placed them (`liveLookChanges()`). Kaizena Flow's own themes take their presets from
 * its code, which writes them again at the next version.
 */
export async function presetCheck(demo: DemoStore): Promise<{ ok: true; changed: LookPart[] } | { ok: false; problems: string[] }> {
  if (!demo.wears) return refuse("It wears no theme: its look is its own. Publish it as a new theme instead.");
  if (demo.wears.archived) return refuse(`${demo.wears.title} is archived. Publish the look as a new theme instead.`);
  if (demo.wears.launch) {
    return refuse(`${demo.wears.title} is one of Kaizena Flow's own themes, whose presets are written in its code: a preset added here would go at its next version. Publish the look as a new theme instead.`);
  }
  const look = await liveLookChanges(demo.storeId);
  if (look.presetId !== demo.wears.presetId) return refuse("Its theme changed just now. Open the page again.");
  if (look.changed === null) return refuse(`Kaizena Flow cannot tell what this demo store changed of ${demo.wears.title}. Publish the look as a new theme instead.`);
  const reason = presetRefusal(look.changed);
  if (reason) return refuse(reason);
  return { ok: true, changed: look.changed };
}

/**
 * *As a preset of {theme}*: the demo store's theme settings (colours, fonts, buttons and the rest) become a new draft preset of the theme it
 * wears (`addVariation()` with the store's settings), sent out when the theme is published. Refused, with the reason, when it changed a part
 * a preset cannot hold (`presetCheck()`).
 */
export async function demoLookAsPreset(admin: Account, id: string, name: string): Promise<StarterResult<{ presetId: string; key: string }>> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const demo = await getDemoStore(id);
  if (!demo) return refuse(UNKNOWN);
  const check = await presetCheck(demo);
  if (!check.ok) return check;
  const presetId = demo.wears!.presetId;
  const [store] = await db().execute<Row>(sql`select theme from commerce.stores where id = ${demo.storeId}::uuid`);
  const theme = parseStoreTheme(store?.theme);
  const added = await addVariation(admin, presetId, name, theme);
  if (!added.ok) return added;
  await audit(admin.id, demo.storeId, "platform.demo_look_published", { starter: id, as: "preset", preset: presetId, variation: added.key }, {
    target: { type: "design_preset", id: presetId },
  });
  return { ok: true, presetId, key: added.key };
}

/**
 * *Into {theme}'s next version*: the demo store's look replaces the draft look of the theme it wears (`copyStoreLookToDraft()`), to review,
 * write What's new for and publish; stores that follow updates get it only then.
 */
export async function demoLookIntoNextVersion(admin: Account, id: string, deps: ApplyDeps = {}): Promise<StarterResult<{ presetId: string; notes: string[] }>> {
  if (!admin.platformAdmin) return refuse(NOT_YOURS);
  const ready = await joined(admin, id);
  if (!ready.ok) return ready;
  const wears = ready.demo.wears;
  if (!wears) return refuse("It wears no theme: its look is its own. Publish it as a new theme instead.");
  if (wears.archived) return refuse(`${wears.title} is archived. Restore it first, or publish the look as a new theme.`);
  const copied = await copyStoreLookToDraft(admin, wears.presetId, ready.demo.storeId, deps);
  if (!copied.ok) return copied;
  const notes = [...copied.notes];
  if (wears.launch) notes.push(`${wears.title} is one of Kaizena Flow's own themes: its next version from the code would replace this draft.`);
  await audit(admin.id, ready.demo.storeId, "platform.demo_look_published", { starter: id, as: "next_version", preset: wears.presetId }, {
    target: { type: "design_preset", id: wears.presetId },
  });
  return { ok: true, presetId: wears.presetId, notes };
}
