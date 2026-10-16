import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db/client";
import { packAboutPage, packHomePage, packProductsPage, type PackPicture } from "@/lib/content-pack-pages";
import { CONTENT_PACKS, contentPack, packPicturePrompt, packPrice, packSlots, packSlug, type ContentPack, type PackProduct } from "@/lib/content-packs";
import { PACK_DESIGNS } from "@/lib/pack-designs";
import type { MenuEntry } from "@/lib/navigation";
import { DEFAULT_APPOINTMENT, GENERAL_TAX_CODE, formatPriceInput, type ProductInput } from "@/lib/product-input";
import { siteUrl } from "@/lib/site";

import { AiError, aiFor, type ImageShape } from "./ai";
import { makePicture } from "./ai-pictures";
import { audit, type Account } from "./auth";
import type { ApplyDeps } from "./design-presets";
import { storePicture } from "./media-library";
import { savePage } from "./pages";
import { emptyProduct, getEditorContext, getProductForEdit, saveProduct, type EditorContext } from "./products";
import { refreshTag } from "./refresh";
import { dressSignaturePacks } from "./signature-themes";
import { createStarter, setStarterFeatures } from "./store-starters";
import { getStore, storeTag, type Store } from "./stores";

/**
 * Kaizena Flow's content packs (`docs/theme-showcase-phase-1.md` step 2): `CONTENT_PACKS` written into store templates of their own (D175),
 * one per trade, each a clean English store of that trade only. `syncContentPacks()` makes a pack's template the first time (copied from the
 * default template as every template is) and writes the pack into it whenever the code's version is newer: the store's name, language,
 * features and menus, the pack's categories, products (the template's own demo products archived, so no copy carries them), home and about
 * pages; nothing else of the template's demo stays. Pictures come after, one per request (`makeNextPackPicture()`, Kaizena Flow's picture
 * model, feature `content_pack`), into the pack store's media library; until a product has its picture it shows `PACK_PLACEHOLDER`, and a pack
 * is published only once every picture is made (`picturesMissing()`, checked by `publishStarter()`). Platform admins only.
 */

type Row = Record<string, unknown>;
/** A list as one Postgres array literal (Drizzle would spread an array into a row). */
const textArray = (values: readonly string[]) => `{${values.map((value) => `"${value.replace(/["\\]/g, "\\$&")}"`).join(",")}}`;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** What a pack's product shows until its picture is made. */
export const PACK_PLACEHOLDER = "/demo/packs/placeholder.svg";
const LOCALE = "en-GB";
/** The salon's team (the services pack), who its appointments are booked with. */
const STAFF = ["Anna", "Jonas"] as const;
const HOURS = {
  week: {
    mon: { open: "09:00", close: "17:00" },
    tue: { open: "09:00", close: "17:00" },
    wed: { open: "09:00", close: "19:00" },
    thu: { open: "09:00", close: "19:00" },
    fri: { open: "09:00", close: "17:00" },
    sat: { open: "10:00", close: "15:00" },
    sun: null,
  },
  exceptions: [],
};

/** A pack's picture as its template keeps it; `art` is the address of the theme's art it was placed from. */
type StoredPicture = PackPicture & { thumbnailUrl?: string | null; art?: string };

/** How a theme's art file reaches a pack store's media library: stored there (the default), or placed as a test or a developer needs. */
export type PackDeps = {
  storeArt?: (owner: { storeId: string; accountId: string }, art: PackPicture) => Promise<StoredPicture>;
  /** What dressing a signature theme's demo store in its theme reaches (`dressSignaturePacks()`). */
  apply?: ApplyDeps;
};

/**
 * One of a signature theme's art files (`public/demo/themes/…`) kept in a pack store's media library, so its pages and products show it as
 * any picture of the store (copied with a new store, counted in the library's uses): read from the site's own files, or from its address
 * where the server has no copy of them (a serverless function), with its small copy made here.
 */
async function storeArtPicture(owner: { storeId: string; accountId: string }, art: PackPicture): Promise<StoredPicture> {
  if (!/^\/demo\/themes\/[a-z0-9-]+\/[a-z0-9-]+\.webp$/.test(art.url)) throw new Error(`${art.url} is not a theme's art file.`);
  let bytes: Buffer;
  try {
    bytes = await readFile(path.join(process.cwd(), "public", art.url));
  } catch {
    const response = await fetch(`${siteUrl()}${art.url}`);
    if (!response.ok) throw new Error(`${art.url} could not be read (${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const thumbnail = await sharp(bytes).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const name = path.basename(art.url);
  const stored = await storePicture(
    owner,
    new File([new Uint8Array(bytes)], name, { type: "image/webp" }),
    new File([new Uint8Array(thumbnail)], name.replace(/\.webp$/, "-480.webp"), { type: "image/webp" }),
    { fileName: name, alt: art.alt, compressed: true },
  );
  if (!stored.ok) throw new Error(`${art.url} could not be stored: ${stored.problem}`);
  return { url: stored.url, thumbnailUrl: stored.thumbnailUrl, width: art.width, height: art.height, alt: art.alt };
}

/**
 * A pack's own art (`ContentPack.art`) in its store's library, once: each slot whose art is not placed yet is stored and recorded in
 * `pack_pictures` with the address it came from, so a later sync reuses it and a new file name places it again.
 */
async function placeArt(admin: Account, row: PackRow, pack: ContentPack, deps: PackDeps): Promise<Record<string, StoredPicture>> {
  const placed = { ...row.pictures };
  for (const [slot, art] of Object.entries(pack.art ?? {})) {
    if (placed[slot]?.art === art.url) continue;
    const stored = await (deps.storeArt ?? storeArtPicture)({ storeId: row.storeId, accountId: admin.id }, art);
    placed[slot] = { ...stored, art: art.url };
    await db().execute(sql`
      update commerce.store_starters set pack_pictures = pack_pictures || ${JSON.stringify({ [slot]: placed[slot] })}::jsonb where id = ${row.starterId}::uuid
    `);
  }
  return placed;
}
type PackRow = { starterId: string; storeId: string; slug: string; version: number | null; pictures: Record<string, StoredPicture>; published: boolean; archived: boolean };

const readPictures = (value: unknown): Record<string, StoredPicture> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, StoredPicture>) : {};

async function packRow(key: string): Promise<PackRow | null> {
  const [row] = await db().execute<Row>(sql`
    select ss.id, ss.store_id, ss.pack_version, ss.pack_pictures, ss.published, ss.archived_at, s.slug
    from commerce.store_starters ss join commerce.stores s on s.id = ss.store_id
    where ss.pack_key = ${key}
  `);
  if (!row) return null;
  return {
    starterId: String(row.id),
    storeId: String(row.store_id),
    slug: String(row.slug),
    version: row.pack_version === null ? null : Number(row.pack_version),
    pictures: readPictures(row.pack_pictures),
    published: row.published === true,
    archived: row.archived_at !== null,
  };
}

/** Each pack as the platform's Store templates page shows it: set up or not, whether its store has the code's version, its pictures made. */
export type PackState = {
  key: string;
  title: string;
  storeName: string;
  starterId: string | null;
  slug: string | null;
  current: boolean;
  published: boolean;
  archived: boolean;
  pictures: number;
  slots: number;
};

export async function contentPackStates(): Promise<PackState[]> {
  return Promise.all(
    CONTENT_PACKS.map(async (pack) => {
      const row = await packRow(pack.key);
      const slots = packSlots(pack);
      return {
        key: pack.key,
        title: pack.title,
        storeName: pack.storeName,
        starterId: row?.starterId ?? null,
        slug: row?.slug ?? null,
        current: row !== null && row.version !== null && row.version >= pack.version,
        published: row?.published ?? false,
        archived: row?.archived ?? false,
        pictures: row ? slots.filter((slot) => row.pictures[slot]).length : 0,
        slots: slots.length,
      };
    }),
  );
}

/** What a sync did, by pack title, and the stores it wrote (for their caches). */
export type SyncResult = { made: string[]; updated: string[]; current: string[]; problems: string[]; stores: { id: string; slug: string }[] };

/**
 * Makes each pack's store template the first time and writes the pack into it whenever the code's version is newer than the one written. A
 * pack whose template is archived is left alone. Never throws: a pack that fails is said, the others go on.
 */
export async function syncContentPacks(admin: Account, deps: PackDeps = {}): Promise<SyncResult> {
  const result: SyncResult = { made: [], updated: [], current: [], problems: [], stores: [] };
  if (!admin.platformAdmin) return { ...result, problems: ["Only Kaizena Flow's admins set up content packs."] };
  for (const pack of CONTENT_PACKS) {
    try {
      let row = await packRow(pack.key);
      if (row?.archived) continue;
      if (row && row.version !== null && row.version >= pack.version) {
        result.current.push(pack.title);
        continue;
      }
      const fresh = row === null;
      if (!row) {
        const made = await createStarter(admin, {
          slug: packSlug(pack.key),
          details: { title: pack.title, summary: pack.summary, description: pack.description, category: pack.category, pictureUrl: null },
        });
        if (!made.ok) {
          result.problems.push(`${pack.title}: ${made.problems.join(" ")}`);
          continue;
        }
        await db().execute(sql`update commerce.store_starters set pack_key = ${pack.key} where id = ${made.id}::uuid and pack_key is null`);
        row = await packRow(pack.key);
        if (!row) throw new Error("The pack's store template was made but could not be found.");
      }
      result.stores.push({ id: row.storeId, slug: row.slug });
      await writePack(admin, row, pack, deps);
      (fresh ? result.made : result.updated).push(pack.title);
    } catch (error) {
      console.error(`[content-packs] ${pack.key} could not be set up`, error);
      result.problems.push(`${pack.title} could not be set up: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (result.made.length + result.updated.length > 0) {
    // A signature theme's demo store wears its theme once both are there (`dressSignaturePacks()`).
    result.problems.push(...(await dressSignaturePacks(admin, deps.apply)));
    await audit(admin.id, null, "platform.content_packs_synced", { made: result.made.length, updated: result.updated.length }, {});
  }
  return result;
}

/** Writes a pack into its store template: everything the store shows, from the pack's data and the pictures made so far. */
async function writePack(admin: Account, row: PackRow, pack: ContentPack, deps: PackDeps): Promise<void> {
  // It sells where the default template does (several countries, each in its own currency), in one language; services book appointments.
  const features = pack.products.some((p) => p.minutes) ? ["shop", "countries", "appointments"] : ["shop", "countries"];
  const switched = await setStarterFeatures(admin, row.starterId, features, { confirmed: true });
  if (!switched.ok) throw new Error(switched.problems.join(" "));
  const handles = pack.products.map((p) => p.handle);
  const slugs = pack.categories.map((c) => c.slug);

  await db().transaction(async (tx) => {
    const storeId = row.storeId;
    // An English store of one trade: its own name, no logo (the name is the brand), English at its country's own address.
    await tx.execute(sql`
      update commerce.stores set name = ${pack.storeName}, navigation = '{"logo":null,"logoDark":null,"favicon":null}'::jsonb, locales = ${`{${LOCALE}}`}::text[]
      where id = ${storeId}::uuid
    `);
    await tx.execute(sql`update commerce.markets set default_locale = ${LOCALE}, locales = ${`{${LOCALE}}`}::text[] where store_id = ${storeId}::uuid`);
    await tx.execute(sql`update commerce.store_starters set title = ${pack.title}, summary = ${pack.summary}, description = ${pack.description}, category = ${pack.category} where id = ${row.starterId}::uuid`);
    // The template's own demo: products archived (copies leave them out), staff, pages and categories that are not the pack's gone.
    await tx.execute(sql`
      update commerce.products set status = 'archived', updated_at = now()
      where store_id = ${storeId}::uuid and status <> 'archived' and not (handle = any(${textArray(handles)}::text[]))
    `);
    await tx.execute(sql`
      delete from commerce.booking_resources b
      where b.store_id = ${storeId}::uuid and not (b.name = any(${textArray(STAFF)}::text[]))
        and not exists (select 1 from commerce.bookings x where x.resource_id = b.id)
    `);
    await tx.execute(sql`
      delete from commerce.pages p
      where p.store_id = ${storeId}::uuid and p.type in ('page', 'article') and p.slug not in ('welcome', 'about')
        and p.id is distinct from (select products_page_id from commerce.stores where id = ${storeId}::uuid)
        and not exists (select 1 from commerce.page_roles r where r.page_id = p.id)
    `);
    await tx.execute(sql`
      delete from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and not (kind = 'category' and slug = any(${textArray(slugs)}::text[]))
    `);
    for (const [position, category] of pack.categories.entries()) {
      await tx.execute(sql`
        insert into commerce.terms (store_id, content_type, kind, name, slug, position)
        values (${storeId}::uuid, 'product', 'category', ${category.name}, ${category.slug}, ${position})
        on conflict (store_id, content_type, kind, slug) do update set name = excluded.name, position = excluded.position
      `);
    }
    await tx.execute(sql`update commerce.inventory_locations set name = 'Warehouse' where store_id = ${storeId}::uuid and name = 'Lager Oslo'`);
    // The maker and the EU responsible person a store selling goods names (GPSR), in the pack's name, their countries in English.
    await tx.execute(sql`
      update commerce.economic_operators
         set postal_address = regexp_replace(regexp_replace(regexp_replace(postal_address, ', Norge$', ', Norway'), ', Sverige$', ', Sweden'), ', Danmark$', ', Denmark')
       where store_id = ${storeId}::uuid
    `);
    await tx.execute(sql`update commerce.economic_operators set name = ${`${pack.storeName} Demo AS`} where store_id = ${storeId}::uuid and country = 'NO'`);
    await tx.execute(sql`
      update commerce.economic_operators set name = ${`${pack.storeName} Demo AB`} where store_id = ${storeId}::uuid and commerce.is_eu_country(country)
    `);
    if (pack.products.some((p) => p.minutes)) {
      for (const [position, name] of STAFF.entries()) {
        await tx.execute(sql`
          insert into commerce.booking_resources (store_id, kind, name, hours, capacity, position)
          select ${storeId}::uuid, 'staff', ${name}, ${JSON.stringify(HOURS)}::jsonb, 1, ${position}
          where not exists (select 1 from commerce.booking_resources where store_id = ${storeId}::uuid and name = ${name})
        `);
      }
    }
    await writeMenus(tx, storeId, pack);
  });
  // Read again: its language, features and categories just changed.
  refreshTag(storeTag(row.slug));
  const store = await getStore(row.slug);
  if (!store) throw new Error("The pack's store could not be read.");
  const editor = await getEditorContext(store);
  // Its own art (a signature theme's, `docs/signature-themes.md`) in its library first; the rest are the pictures made so far.
  const pictures = await placeArt(admin, row, pack, deps);
  for (const product of pack.products) await writeProduct(store, editor, admin, pack, product, pictures[`product:${product.handle}`] ?? null);
  await writePages(admin, row.storeId, pack, pictures);
  await db().execute(sql`update commerce.store_starters set pack_version = ${pack.version}, updated_by = ${admin.id}::uuid where id = ${row.starterId}::uuid`);
}

/** A pack product's picture as the editor keeps it, or the placeholder until it is made. */
const mediaOf = (product: PackProduct, picture: StoredPicture | null) => [
  { url: picture?.url ?? PACK_PLACEHOLDER, thumbnailUrl: picture?.thumbnailUrl ?? null, alt: product.title },
];

/**
 * One product, through the product editor's own save (`saveProduct()`: its checks, its prices through `commerce.set_price` with the price
 * entry, its stock as an opening movement): made the first time with its picture or the placeholder, its words, category and prices brought
 * up to date after (its picture as it is).
 */
async function writeProduct(store: Store, editor: EditorContext, admin: Account, pack: ContentPack, product: PackProduct, picture: StoredPicture | null): Promise<void> {
  const appointment = Boolean(product.minutes);
  const [existing] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.id}::uuid and handle = ${product.handle}`);
  const stored = existing ? await getProductForEdit(store, editor, String(existing.id)) : null;
  const base = stored ?? emptyProduct(editor);
  const category = editor.terms.find((t) => t.kind === "category" && t.slug === product.category);
  const maker = editor.operators.find((o) => o.country === "NO");
  const representative = editor.operators.find((o) => o.country === "SE");
  if (!appointment && (!maker || !representative)) throw new Error("The template has no maker and EU responsible person to name on its goods.");
  const staff = editor.staff.filter((s) => s.kind === "staff" && s.active).map((s) => s.id);
  const variant = base.variants[0];
  // A picture already on it stays (a platform admin may have replaced it in the pack's store); the placeholder gives way to a made one.
  const media = stored && stored.media.some((m) => m.url !== PACK_PLACEHOLDER) ? stored.media : mediaOf(product, picture);
  const input: ProductInput = {
    ...base,
    handle: product.handle,
    status: "active",
    translations: [{ locale: LOCALE, title: product.title, description: product.description, safetyInformation: "", seoTitle: "", seoDescription: "", excerpt: "" }],
    media,
    options: [],
    variants: [
      {
        ...variant,
        options: {},
        sku: stored ? variant.sku : `PACK-${pack.key}-${product.handle}`.toUpperCase(),
        prices: Object.fromEntries(editor.markets.map((m) => [m.code, formatPriceInput(packPrice(product.price, m.code), m.currency)])),
        stock: stored ? variant.stock : appointment ? 0 : 40,
        active: true,
        weightGrams: product.grams ?? null,
        delivery: appointment ? "service" : "physical",
        image: { url: media[0].url, thumbnailUrl: media[0].thumbnailUrl },
      },
    ],
    delivery: appointment ? "service" : "physical",
    kind: appointment ? "appointment" : "goods",
    appointment: appointment
      ? {
          ...(stored?.appointment ?? DEFAULT_APPOINTMENT),
          durationMinutes: product.minutes ?? 30,
          bufferAfterMinutes: 10,
          stepMinutes: 15,
          minNoticeMinutes: 120,
          maxDaysAhead: 60,
          resourceIds: staff,
        }
      : null,
    vatCategory: pack.key === "food" ? "food" : "standard",
    taxCode: appointment ? "txcd_20030000" : GENERAL_TAX_CODE,
    schemes: appointment ? [] : ["packaging"],
    manufacturer: appointment ? null : { id: maker!.id },
    responsiblePerson: appointment ? null : { id: representative!.id },
    categories: category ? [category.id] : [],
    tags: [],
  };
  const saved = await saveProduct(store, editor, stored ? String(existing.id) : null, input, undefined, undefined, { id: admin.id });
  if (!saved.ok) throw new Error(`${product.title}: ${saved.problems.join(" ")}`);
}

/** Puts a made picture on a pack's product, through the editor's save as anything else that changes a product. */
async function setProductPicture(store: Store, admin: Account, product: PackProduct, picture: StoredPicture): Promise<void> {
  const editor = await getEditorContext(store);
  const [existing] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.id}::uuid and handle = ${product.handle}`);
  const stored = existing ? await getProductForEdit(store, editor, String(existing.id)) : null;
  if (!stored) throw new Error(`${product.title} is not in the pack's store. Set up the content packs again.`);
  const media = mediaOf(product, picture);
  const saved = await saveProduct(
    store,
    editor,
    String(existing.id),
    { ...stored, media, variants: stored.variants.map((v) => ({ ...v, image: { url: media[0].url, thumbnailUrl: media[0].thumbnailUrl } })) },
    undefined,
    undefined,
    { id: admin.id },
  );
  if (!saved.ok) throw new Error(`${product.title}: ${saved.problems.join(" ")}`);
}

/** The header menu (home, the shop with its categories under it, about) and the footer's, in the store's own two menus. */
async function writeMenus(tx: Tx, storeId: string, pack: ContentPack): Promise<void> {
  const label = (text: string) => ({ [LOCALE]: text });
  const shop = pack.products.some((p) => p.minutes) ? "Services" : "Shop";
  const header: MenuEntry[] = [
    { label: label("Home"), link: { kind: "home" }, depth: 0 },
    { label: label(shop), link: { kind: "products" }, depth: 0 },
    ...pack.categories.map((c): MenuEntry => ({ label: label(c.name), link: { kind: "category", slug: c.slug }, depth: 1 })),
    { label: label("About"), link: { kind: "page", slug: "about" }, depth: 0 },
  ];
  const footer: MenuEntry[] = [
    { label: label(shop), link: { kind: "products" }, depth: 0 },
    ...pack.categories.map((c): MenuEntry => ({ label: label(c.name), link: { kind: "category", slug: c.slug }, depth: 0 })),
    { label: label("About"), link: { kind: "page", slug: "about" }, depth: 0 },
  ];
  for (const [column, items, name] of [["header_menu_id", header, "Main menu"], ["footer_menu_id", footer, "Footer menu"]] as const) {
    const [store] = await tx.execute<Row>(sql`select ${sql.raw(column)} as id from commerce.stores where id = ${storeId}::uuid`);
    if (store?.id) {
      await tx.execute(sql`update commerce.menus set items = ${JSON.stringify(items)}::jsonb where id = ${String(store.id)}::uuid and store_id = ${storeId}::uuid`);
    } else {
      const [menu] = await tx.execute<Row>(sql`
        insert into commerce.menus (store_id, name, items) values (${storeId}::uuid, ${name}, ${JSON.stringify(items)}::jsonb)
        on conflict (store_id, name) do update set items = excluded.items
        returning id
      `);
      await tx.execute(sql`update commerce.stores set ${sql.raw(column)} = ${String(menu.id)}::uuid where id = ${storeId}::uuid`);
    }
  }
}

/**
 * The pack's home page (its front page), its about page and its All products page, published, through the builder's save: the pages its
 * theme designed for it (`PACK_DESIGNS`), else the common ones.
 */
async function writePages(admin: Account, storeId: string, pack: ContentPack, pictures: Record<string, StoredPicture>): Promise<void> {
  const picture = (slot: string): PackPicture | null => {
    const found = pictures[slot];
    return found ? { url: found.url, width: found.width, height: found.height, alt: found.alt } : null;
  };
  const save = async (slug: string, content: unknown) => {
    const [page] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${storeId}::uuid and type = 'page' and slug = ${slug}`);
    const saved = await savePage(admin, storeId, page ? String(page.id) : null, content, { publish: true });
    if (!saved.ok) throw new Error(`Its ${slug} page could not be saved: ${saved.problems.join(" ")}`);
    return saved.id;
  };
  const design = pack.design ? PACK_DESIGNS[pack.design] : null;
  const home = await save("welcome", design ? design.home(pack, picture) : packHomePage(pack, { hero: picture("hero"), story: picture("story") }));
  await save("about", design ? design.about(pack, picture) : packAboutPage(pack, picture("story")));
  await db().execute(sql`update commerce.stores set front_page_id = ${home}::uuid where id = ${storeId}::uuid`);
  // The All products page (D83): the template's is in its own language, so the pack writes its own.
  const [products] = await db().execute<Row>(sql`select products_page_id as id from commerce.stores where id = ${storeId}::uuid`);
  const saved = await savePage(admin, storeId, products?.id ? String(products.id) : null, packProductsPage(pack), { publish: true });
  if (!saved.ok) throw new Error(`Its All products page could not be saved: ${saved.problems.join(" ")}`);
  if (!products?.id) await db().execute(sql`update commerce.stores set products_page_id = ${saved.id}::uuid where id = ${storeId}::uuid`);
}

/**
 * Makes the next picture a pack lacks, in its slots' order (its hero, its story, then each product), with Kaizena Flow's picture model, and
 * puts it where it belongs: a product's picture and its variant's, or the home and about pages (published again). One a request: the page
 * calls again while some remain.
 */
export async function makeNextPackPicture(
  admin: Account,
  key: string,
  deps: { make?: typeof makePicture; connection?: Awaited<ReturnType<typeof aiFor>> } = {},
): Promise<{ ok: true; made: string | null; remaining: number; store: { id: string; slug: string } } | { ok: false; problems: string[] }> {
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizena Flow's admins make content packs' pictures."] };
  const pack = contentPack(key);
  const row = pack ? await packRow(pack.key) : null;
  if (!pack || !row) return { ok: false, problems: ["Set up the content packs first."] };
  if (row.version === null || row.version < pack.version) return { ok: false, problems: [`Set up ${pack.title} again first: its store has an older version.`] };
  const slots = packSlots(pack);
  const missing = slots.filter((slot) => !row.pictures[slot] && !pack.art?.[slot]);
  if (missing.length === 0) return { ok: true, made: null, remaining: 0, store: { id: row.storeId, slug: row.slug } };
  const slot = missing[0];
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(null, { feature: "content_pack", accountId: admin.id });
  if (!connection?.image) {
    return { ok: false, problems: ["Kaizena Flow's AI settings have no picture model. Choose one in the platform's AI settings first."] };
  }
  const product = slot.startsWith("product:") ? pack.products.find((p) => `product:${p.handle}` === slot) : undefined;
  const subject = slot === "hero" ? pack.heroPicture : slot === "story" ? pack.storyPicture : (product?.picture ?? pack.heroPicture);
  const shape: ImageShape = product ? "square" : "landscape";
  const alt = product ? product.title : slot === "hero" ? `${pack.storeName}: ${pack.headline}` : `${pack.storeName}: ${pack.storyTitle}`;
  let made: Awaited<ReturnType<typeof makePicture>>;
  try {
    made = await (deps.make ?? makePicture)(connection, { storeId: row.storeId, accountId: admin.id }, { prompt: packPicturePrompt(pack, subject), alt, shape });
  } catch (error) {
    return { ok: false, problems: [error instanceof AiError ? error.message : "The picture could not be made. Try again."] };
  }
  if (!made.ok) return { ok: false, problems: [made.problem] };
  const picture: StoredPicture = { url: made.picture.url, width: made.picture.width, height: made.picture.height, alt, thumbnailUrl: made.picture.thumbnailUrl };
  if (product) {
    const store = await getStore(row.slug);
    if (!store) return { ok: false, problems: ["The pack's store could not be read."] };
    await setProductPicture(store, admin, product, picture);
  } else {
    await writePages(admin, row.storeId, pack, { ...row.pictures, [slot]: picture });
  }
  // Kept last: a picture that could not be placed is made again next time.
  await db().execute(sql`
    update commerce.store_starters set pack_pictures = pack_pictures || ${JSON.stringify({ [slot]: picture })}::jsonb where id = ${row.starterId}::uuid
  `);
  await audit(admin.id, row.storeId, "platform.content_pack_picture", { pack: pack.key, slot }, {});
  return { ok: true, made: slot, remaining: missing.length - 1, store: { id: row.storeId, slug: row.slug } };
}
