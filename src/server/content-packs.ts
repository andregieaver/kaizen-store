import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";
import sharp from "sharp";

import { db } from "@/db/client";
import { packAboutPage, packHomePage, packProductsPage, type PackPicture } from "@/lib/content-pack-pages";
import {
  CONTENT_PACKS,
  contentPack,
  packPhotoPrompt,
  packPicturePrompt,
  packPrice,
  packSlots,
  packSlug,
  slotBrief,
  slotLabel,
  slotMissing,
  slotShape,
  type ContentPack,
  type PackProduct,
} from "@/lib/content-packs";
import { PACK_DESIGNS } from "@/lib/pack-designs";
import { SLOT_BRIEF_MAX } from "@/lib/picture-direction";
import type { MenuEntry } from "@/lib/navigation";
import { DEFAULT_APPOINTMENT, GENERAL_TAX_CODE, formatPriceInput, type ProductInput } from "@/lib/product-input";
import { siteUrl } from "@/lib/site";

import { AiError, aiFor, type ImageShape } from "./ai";
import { makePicture } from "./ai-pictures";
import { activeAccount, audit, type Account } from "./auth";
import { catalogTag } from "./catalog";
import type { ApplyDeps } from "./design-presets";
import { rewriteAddresses } from "./media-compress";
import { storePicture } from "./media-library";
import { pagesTag, savePage } from "./pages";
import { emptyProduct, getEditorContext, getProductForEdit, saveProduct, type EditorContext } from "./products";
import { refreshTag } from "./refresh";
import { dressSignaturePacks, linkLaunchContents } from "./signature-themes";
import { createStarter, setStarterFeatures } from "./store-starters";
import { getStore, storeTag, type Store } from "./stores";
import { termsTag } from "./taxonomy";

/**
 * Kaizena Flow's content packs (`docs/theme-showcase-phase-1.md` step 2): `CONTENT_PACKS` written into store templates of their own (D175),
 * one per trade, each a clean English store of that trade only. `syncContentPacks()` makes a pack's template the first time (copied from the
 * default template as every template is) and writes the pack into it whenever the code's version is newer: the store's name, language,
 * features and menus, the pack's categories, products (the template's own demo products archived, so no copy carries them), home and about
 * pages; nothing else of the template's demo stays. Pictures come after, one at a time (`makeNextPackPicture()`, Kaizena Flow's picture
 * model, feature `content_pack`), made by a job once asked for (`askForPackPictures()`, `runPackPictures()`, D271), into the pack store's
 * media library; until a product has its picture it shows `PACK_PLACEHOLDER`, and a pack is published only once every picture is made
 * (`picturesMissing()`, checked by `publishStarter()`). Platform admins only.
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

/**
 * A pack's picture as its template keeps it; `art` is the address of the theme's art it was placed from. A picture made again (D283) keeps
 * the brief it was made from when a person changed the pack's (`brief`), the one it replaced (`previous`, for *Put back the one before*),
 * and, while it is asked to be made again, `again` with the brief to make it from (null: the pack's, or the one it was last made from).
 */
type StoredPicture = PackPicture & {
  thumbnailUrl?: string | null;
  art?: string;
  brief?: string;
  previous?: StoredPicture;
  again?: { brief: string | null };
};

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
    // Placed already, or a photograph made for the slot (D270), which its art never replaces.
    if (placed[slot]?.art === art.url || (placed[slot] && !placed[slot].art)) continue;
    const stored = await (deps.storeArt ?? storeArtPicture)({ storeId: row.storeId, accountId: admin.id }, art);
    placed[slot] = { ...stored, art: art.url };
    await db().execute(sql`
      update commerce.store_starters set pack_pictures = pack_pictures || ${JSON.stringify({ [slot]: placed[slot] })}::jsonb where id = ${row.starterId}::uuid
    `);
  }
  return placed;
}
type PackRow = {
  starterId: string;
  storeId: string;
  slug: string;
  version: number | null;
  pictures: Record<string, StoredPicture>;
  published: boolean;
  archived: boolean;
  /** Its pictures are asked for (D271): the job makes them. */
  asked: boolean;
  /** Why the last try failed, while it is the last word on them. */
  problem: string | null;
};

const readPictures = (value: unknown): Record<string, StoredPicture> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, StoredPicture>) : {};

async function packRow(key: string): Promise<PackRow | null> {
  const [row] = await db().execute<Row>(sql`
    select ss.id, ss.store_id, ss.pack_version, ss.pack_pictures, ss.published, ss.archived_at, s.slug, ss.pictures_wanted_at, ss.picture_problem
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
    asked: row.pictures_wanted_at !== null,
    problem: typeof row.picture_problem === "string" ? row.picture_problem : null,
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
  /** Its pictures are being made by the job (D271). */
  asked: boolean;
  problem: string | null;
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
        pictures: row ? slots.filter((slot) => !slotMissing(pack, slot, row.pictures[slot])).length : 0,
        slots: slots.length,
        asked: row?.asked ?? false,
        problem: row?.problem ?? null,
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
        if (!row) throw new Error("The pack's demo store was made but could not be found.");
      }
      result.stores.push({ id: row.storeId, slug: row.slug });
      await writePack(admin, row, pack, deps);
      (fresh ? result.made : result.updated).push(pack.title);
    } catch (error) {
      console.error(`[content-packs] ${pack.key} could not be set up`, error);
      result.problems.push(`${pack.title} could not be set up: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Each launch theme's own content, linked once the theme is there too (D275).
  await linkLaunchContents();
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
  await writePages(admin, row.storeId, pack, pictures, deps);
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
async function writePages(admin: Account, storeId: string, pack: ContentPack, pictures: Record<string, StoredPicture>, deps: PackDeps): Promise<void> {
  // The pages' fonts are installed as dressing the store installs the theme's (`deps.apply`).
  const fonts = deps.apply?.installFonts;
  const picture = (slot: string): PackPicture | null => {
    const found = pictures[slot];
    return found ? { url: found.url, width: found.width, height: found.height, alt: found.alt } : null;
  };
  const save = async (slug: string, content: unknown) => {
    const [page] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${storeId}::uuid and type = 'page' and slug = ${slug}`);
    const saved = await savePage(admin, storeId, page ? String(page.id) : null, content, { publish: true, ...(fonts && { fonts }) });
    if (!saved.ok) throw new Error(`Its ${slug} page could not be saved: ${saved.problems.join(" ")}`);
    return saved.id;
  };
  const design = pack.design ? PACK_DESIGNS[pack.design] : null;
  const home = await save("welcome", design ? design.home(pack, picture) : packHomePage(pack, { hero: picture("hero"), story: picture("story") }));
  await save("about", design ? design.about(pack, picture) : packAboutPage(pack, picture("story")));
  await db().execute(sql`update commerce.stores set front_page_id = ${home}::uuid where id = ${storeId}::uuid`);
  // The All products page (D83): the template's is in its own language, so the pack writes its own.
  const [products] = await db().execute<Row>(sql`select products_page_id as id from commerce.stores where id = ${storeId}::uuid`);
  const saved = await savePage(admin, storeId, products?.id ? String(products.id) : null, packProductsPage(pack), { publish: true, ...(fonts && { fonts }) });
  if (!saved.ok) throw new Error(`Its All products page could not be saved: ${saved.problems.join(" ")}`);
  if (!products?.id) await db().execute(sql`update commerce.stores set products_page_id = ${saved.id}::uuid where id = ${storeId}::uuid`);
}

/**
 * Makes the next picture a pack lacks, in its slots' order (its hero, its story, its designed pages' other photographs, then each product),
 * with Kaizena Flow's picture model, and puts it where it belongs: a product's picture and its variant's, or the home and about pages
 * (published again). A signature theme's pack has each made as a photograph from its brief, in place of the art that stood in (D270). One a
 * request: the page calls again while some remain.
 */
export async function makeNextPackPicture(
  admin: Account,
  key: string,
  deps: { make?: typeof makePicture; connection?: Awaited<ReturnType<typeof aiFor>>; apply?: PackDeps["apply"] } = {},
): Promise<{ ok: true; made: string | null; remaining: number; store: { id: string; slug: string } } | { ok: false; problems: string[] }> {
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizena Flow's admins make content packs' pictures."] };
  const pack = contentPack(key);
  const row = pack ? await packRow(pack.key) : null;
  if (!pack || !row) return { ok: false, problems: ["Set up the content packs first."] };
  if (row.version === null || row.version < pack.version) return { ok: false, problems: [`Set up ${pack.title} again first: its store has an older version.`] };
  const slots = packSlots(pack);
  const missing = slots.filter((slot) => slotMissing(pack, slot, row.pictures[slot]));
  // Pictures asked to be made again (D283) come after the missing ones.
  const again = slots.filter((slot) => !missing.includes(slot) && row.pictures[slot]?.again);
  const wanted = [...missing, ...again];
  if (wanted.length === 0) return { ok: true, made: null, remaining: 0, store: { id: row.storeId, slug: row.slug } };
  const slot = wanted[0];
  const held = again.includes(slot) ? row.pictures[slot] : undefined;
  const connection = deps.connection !== undefined ? deps.connection : await aiFor(null, { feature: "content_pack", accountId: admin.id });
  if (!connection?.image) {
    return { ok: false, problems: ["Kaizena Flow's AI settings have no picture model. Choose one in the platform's AI settings first."] };
  }
  const product = slot.startsWith("product:") ? pack.products.find((p) => `product:${p.handle}` === slot) : undefined;
  // A photograph from its brief (D270), else the pack's own picture of the slot; made again, from the brief the person gave or kept.
  const photo = pack.photos?.[slot];
  const brief = held ? (held.again?.brief ?? held.brief ?? null) : null;
  const shape: ImageShape = slotShape(pack, slot);
  const alt = photo?.alt ?? (product ? product.title : slot === "hero" ? `${pack.storeName}: ${pack.headline}` : `${pack.storeName}: ${pack.storyTitle}`);
  const prompt = photo ? packPhotoPrompt(pack, brief ? { ...photo, brief } : photo) : packPicturePrompt(pack, brief ?? slotBrief(pack, slot));
  let made: Awaited<ReturnType<typeof makePicture>>;
  try {
    // A store template's pictures are its showcase: always asked for at the model's best.
    made = await (deps.make ?? makePicture)(connection, { storeId: row.storeId, accountId: admin.id }, { prompt, alt, shape, quality: "high" });
  } catch (error) {
    return { ok: false, problems: [error instanceof AiError ? error.message : "The picture could not be made. Try again."] };
  }
  if (!made.ok) return { ok: false, problems: [made.problem] };
  const picture: StoredPicture = { url: made.picture.url, width: made.picture.width, height: made.picture.height, alt, thumbnailUrl: made.picture.thumbnailUrl };
  if (held) {
    // Made again: put where the one before is, wherever the store uses it, and keep that one to put back.
    await swapPackPicture(row, slot, held, { ...picture, ...(brief && { brief }) });
    await audit(admin.id, row.storeId, "platform.content_pack_picture", { pack: pack.key, slot, again: true }, {});
    return { ok: true, made: slot, remaining: wanted.length - 1, store: { id: row.storeId, slug: row.slug } };
  }
  if (product) {
    const store = await getStore(row.slug);
    if (!store) return { ok: false, problems: ["The pack's store could not be read."] };
    await setProductPicture(store, admin, product, picture);
  } else {
    await writePages(admin, row.storeId, pack, { ...row.pictures, [slot]: picture }, { apply: deps.apply });
  }
  // Kept last: a picture that could not be placed is made again next time.
  await db().execute(sql`
    update commerce.store_starters set pack_pictures = pack_pictures || ${JSON.stringify({ [slot]: picture })}::jsonb where id = ${row.starterId}::uuid
  `);
  await audit(admin.id, row.storeId, "platform.content_pack_picture", { pack: pack.key, slot }, {});
  return { ok: true, made: slot, remaining: wanted.length - 1, store: { id: row.storeId, slug: row.slug } };
}

/** What a pack's pictures keep with every `again` mark taken off (D283): stopping, or giving up after failures, ends the remakes asked for. */
const WITHOUT_AGAIN = sql`(select coalesce(jsonb_object_agg(e.key, e.value - 'again'), '{}'::jsonb) from jsonb_each(pack_pictures) as e)`;

/**
 * One picture of a pack's store in place of another (D283): every editable place of the store that names the one before (its pages, products,
 * variants, menus and the rest `rewriteAddresses()` moves) names the new one, each page and product changed is marked changed (so the theme's
 * content shows changes since it was published), and the slot keeps the new one with the one before. One transaction.
 */
async function swapPackPicture(row: PackRow, slot: string, from: StoredPicture, to: StoredPicture): Promise<void> {
  const pairs: [string, string][] = [[from.url, to.url]];
  if (from.thumbnailUrl && to.thumbnailUrl) pairs.push([from.thumbnailUrl, to.thumbnailUrl]);
  // The one before is kept as it was, without its own one before or a wish to make it again.
  const before: StoredPicture = { ...from };
  delete before.previous;
  delete before.again;
  const kept: StoredPicture = { ...to, previous: before };
  await db().transaction(async (tx) => {
    for (const statement of rewriteAddresses(row.storeId, pairs)) await tx.execute(statement);
    await tx.execute(sql`
      update commerce.pages set updated_at = now()
      where store_id = ${row.storeId}::uuid and (position(${to.url} in draft::text) > 0 or position(${to.url} in coalesce(published::text, '')) > 0)
    `);
    await tx.execute(sql`
      update commerce.products p set updated_at = now()
      where p.store_id = ${row.storeId}::uuid
        and (exists (select 1 from commerce.product_media m where m.product_id = p.id and m.url = ${to.url})
          or exists (select 1 from commerce.product_variants v where v.product_id = p.id and v.image_url = ${to.url}))
    `);
    await tx.execute(sql`
      update commerce.store_starters set pack_pictures = pack_pictures || ${JSON.stringify({ [slot]: kept })}::jsonb where id = ${row.starterId}::uuid
    `);
  });
}

/** A pack's picture slot as the theme's Content tab shows it (D283). */
export type PackSlotView = {
  slot: string;
  label: string;
  /** Its picture now: a made one, or art standing in; null before either. */
  picture: { url: string; thumbnailUrl: string | null } | null;
  /** `made` by the picture model (it can be made again), `art` standing in until its photograph is made, `drawn` art meant to stay, `missing`. */
  state: "made" | "art" | "drawn" | "missing";
  /** What making it again starts from: the brief it was last made from, else the pack's. */
  brief: string;
  /** Asked to be made again, while the job is asked for the pack's pictures. */
  again: boolean;
  /** It replaced one that can be put back. */
  previous: boolean;
};

/** Each of a pack's picture slots with its picture and what can be done with it, in the slots' order; null for a pack not set up. */
export async function packSlotViews(key: string): Promise<PackSlotView[] | null> {
  const pack = contentPack(key);
  const row = pack ? await packRow(pack.key) : null;
  if (!pack || !row) return null;
  return packSlots(pack).map((slot): PackSlotView => {
    const held = row.pictures[slot];
    const state = !held ? (pack.art?.[slot] ? "art" : "missing") : held.art ? (pack.photos?.[slot] ? "art" : "drawn") : "made";
    return {
      slot,
      label: slotLabel(pack, slot),
      picture: held ? { url: held.url, thumbnailUrl: held.thumbnailUrl ?? null } : null,
      state,
      brief: held?.brief ?? slotBrief(pack, slot),
      again: Boolean(held?.again) && row.asked,
      previous: Boolean(held?.previous),
    };
  });
}

/** A pack, its template's row and one of its slots' made picture, or why not: for making it again or putting back the one before. */
async function madeSlot(admin: Account, key: string, slot: string): Promise<{ pack: ContentPack; row: PackRow; held: StoredPicture } | { problems: string[] }> {
  if (!admin.platformAdmin) return { problems: ["Only Kaizena Flow's admins make content packs' pictures."] };
  const pack = contentPack(key);
  const row = pack ? await packRow(pack.key) : null;
  if (!pack || !row || row.archived) return { problems: ["Set up the content packs first."] };
  if (row.version === null || row.version < pack.version) return { problems: [`Bring ${pack.title} up to date first: its store has an older version.`] };
  if (!packSlots(pack).includes(slot)) return { problems: ["That picture is not one of the pack's."] };
  const held = row.pictures[slot];
  if (!held || held.art) return { problems: ["This picture has not been made yet: make the pack's pictures first."] };
  return { pack, row, held };
}

/**
 * *Make again* (D283): asks the job to make one of a pack's pictures again, from the pack's brief or one the person changed (`brief`, kept
 * with the picture made from it), and starts the job for it as *Make the pictures* does. The picture stays as it is until the new one is
 * made, then the new one takes its place everywhere the store uses it.
 */
export async function askToRemakePackPicture(
  admin: Account,
  key: string,
  slot: string,
  brief: string | null,
): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const found = await madeSlot(admin, key, slot);
  if ("problems" in found) return { ok: false, problems: found.problems };
  const said = brief?.replace(/\s+/g, " ").trim() ?? "";
  if (said.length > SLOT_BRIEF_MAX) return { ok: false, problems: [`Describe it in at most ${SLOT_BRIEF_MAX} characters.`] };
  // The pack's own brief is kept as none, so the pack's newer words reach it later.
  const own = said && said !== slotBrief(found.pack, slot) ? said : null;
  await db().execute(sql`
    update commerce.store_starters
    set pack_pictures = jsonb_set(pack_pictures, ${textArray([slot, "again"])}::text[], ${JSON.stringify({ brief: own })}::jsonb),
      pictures_wanted_by = ${admin.id}::uuid, pictures_wanted_at = coalesce(pictures_wanted_at, now()), picture_failures = 0, picture_problem = null
    where id = ${found.row.starterId}::uuid
  `);
  return { ok: true };
}

/** *Put back the one before* (D283): the picture a remake replaced takes its place again everywhere, and the remake is kept to swap back. */
export async function putBackPackPicture(admin: Account, key: string, slot: string): Promise<{ ok: true; store: { id: string; slug: string } } | { ok: false; problems: string[] }> {
  const found = await madeSlot(admin, key, slot);
  if ("problems" in found) return { ok: false, problems: found.problems };
  const { previous, ...current } = found.held;
  if (!previous) return { ok: false, problems: ["There is no picture before this one to put back."] };
  if (found.held.again && found.row.asked) return { ok: false, problems: ["It is being made again. Wait for the new picture, or stop it first."] };
  await swapPackPicture(found.row, slot, current, previous);
  await audit(admin.id, found.row.storeId, "platform.content_pack_picture", { pack: found.pack.key, slot, putBack: true }, {});
  return { ok: true, store: { id: found.row.storeId, slug: found.row.slug } };
}

/** The pack stores whose pictures changed, refreshed where their pages and products are drawn. */
export function refreshPackStores(stores: { id: string; slug: string }[]): void {
  for (const store of stores) {
    refreshTag(storeTag(store.slug));
    refreshTag(catalogTag(store.id));
    refreshTag(pagesTag(store.id));
    refreshTag(termsTag({ storeId: store.id, contentType: "product" }));
  }
}

/** Tries in a row that may fail before the job stops making a pack's pictures and says why. */
export const PICTURE_TRIES = 3;
/** Packs whose pictures are made at the same time: one picture of each at a time, so two runs never make the same slot. */
const PICTURES_AT_ONCE = 2;

/**
 * *Make the pictures* (D271): asks the job to make the pictures the packs named still lack, in the person's name, and forgets earlier
 * failures. A pack already asked for keeps its place in the queue. The page no longer waits for each picture, so the person may leave it.
 */
export async function askForPackPictures(admin: Account, keys: string[]): Promise<{ ok: true; asked: string[] } | { ok: false; problems: string[] }> {
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizena Flow's admins make content packs' pictures."] };
  const asked: string[] = [];
  for (const key of keys) {
    const pack = contentPack(key);
    const row = pack ? await packRow(pack.key) : null;
    if (!pack || !row || row.archived || row.version === null || row.version < pack.version) continue;
    if (!packSlots(pack).some((slot) => slotMissing(pack, slot, row.pictures[slot]))) continue;
    await db().execute(sql`
      update commerce.store_starters
      set pictures_wanted_by = ${admin.id}::uuid, pictures_wanted_at = coalesce(pictures_wanted_at, now()), picture_failures = 0, picture_problem = null
      where id = ${row.starterId}::uuid
    `);
    asked.push(pack.title);
  }
  if (asked.length === 0) return { ok: false, problems: ["There are no pictures to make. Set up the content packs first, or bring them up to date."] };
  return { ok: true, asked };
}

/** *Stop*: the job makes no more of the pack's pictures; one being made is finished and kept. */
export async function stopPackPictures(admin: Account, key: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!admin.platformAdmin) return { ok: false, problems: ["Only Kaizena Flow's admins make content packs' pictures."] };
  await db().execute(sql`
    update commerce.store_starters set pictures_wanted_by = null, pictures_wanted_at = null, pack_pictures = ${WITHOUT_AGAIN} where pack_key = ${key}
  `);
  return { ok: true };
}

/**
 * Takes the pack asked for first that no run holds, while fewer than `PICTURES_AT_ONCE` are held (under a lock, so two runs never count
 * the same free place), and holds it for a little longer than the picture model's limit and the placing after it.
 */
async function claimPack(): Promise<{ starterId: string; key: string; wantedBy: string } | null> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('kaizen-pack-pictures'))`);
    const [row] = await tx.execute<Row>(sql`
      update commerce.store_starters set picture_claimed_until = now() + interval '4 minutes'
      where id = (
        select id from commerce.store_starters
        where pictures_wanted_at is not null and (picture_claimed_until is null or picture_claimed_until < now())
          and (select count(*) from commerce.store_starters held where held.picture_claimed_until > now()) < ${PICTURES_AT_ONCE}
        order by pictures_wanted_at, id
        limit 1
      )
      returning id, pack_key, pictures_wanted_by
    `);
    return row ? { starterId: String(row.id), key: String(row.pack_key), wantedBy: String(row.pictures_wanted_by) } : null;
  });
}

/**
 * The job (D271, `/api/cron/pack-pictures` every minute, and at once after *Make the pictures*): makes the pictures packs are asked for,
 * one per pack at a time through `makeNextPackPicture()` in the name of the admin who asked (who must still be one), starting none after
 * `until`. A pack stops being asked for when none is missing, or after `PICTURE_TRIES` failures in a row, keeping the last reason for the
 * page. Never throws.
 */
export async function runPackPictures(
  until: number,
  deps: Parameters<typeof makeNextPackPicture>[2] = {},
): Promise<{ made: number; failed: number; stores: { id: string; slug: string }[] }> {
  const result = { made: 0, failed: 0, stores: [] as { id: string; slug: string }[] };
  while (Date.now() < until) {
    let claimed: Awaited<ReturnType<typeof claimPack>>;
    try {
      claimed = await claimPack();
    } catch (error) {
      console.error("[pack-pictures] no pack could be taken:", error);
      break;
    }
    if (!claimed) break;
    let outcome: Awaited<ReturnType<typeof makeNextPackPicture>>;
    try {
      const admin = await activeAccount(claimed.wantedBy);
      outcome = admin?.platformAdmin
        ? await makeNextPackPicture(admin, claimed.key, deps)
        : { ok: false, problems: ["The admin who asked for these pictures is no longer one of Kaizena Flow's admins. Ask again."] };
    } catch (error) {
      console.error("[pack-pictures] a picture could not be made:", error);
      outcome = { ok: false, problems: ["The picture could not be made."] };
    }
    try {
      if (outcome.ok) {
        // Stop pressed meanwhile has already cleared the wish, and the picture made is kept.
        const done = outcome.remaining === 0;
        const store = outcome.store;
        await db().execute(sql`
          update commerce.store_starters
          set picture_claimed_until = null, picture_failures = 0, picture_problem = null,
            pictures_wanted_by = case when ${done}::boolean then null else pictures_wanted_by end,
            pictures_wanted_at = case when ${done}::boolean then null else pictures_wanted_at end
          where id = ${claimed.starterId}::uuid
        `);
        if (outcome.made) {
          result.made += 1;
          if (!result.stores.some((one) => one.id === store.id)) result.stores.push(store);
        }
      } else {
        result.failed += 1;
        const problem = outcome.problems.join(" ").slice(0, 500);
        // Held a little longer, so the next try waits out what may pass (a busy picture model) instead of following at once.
        await db().execute(sql`
          update commerce.store_starters
          set picture_claimed_until = now() + interval '2 minutes', picture_failures = least(picture_failures + 1, 20), picture_problem = ${problem},
            pictures_wanted_by = case when picture_failures + 1 >= ${PICTURE_TRIES} then null else pictures_wanted_by end,
            pictures_wanted_at = case when picture_failures + 1 >= ${PICTURE_TRIES} then null else pictures_wanted_at end,
            pack_pictures = case when picture_failures + 1 >= ${PICTURE_TRIES} then ${WITHOUT_AGAIN} else pack_pictures end
          where id = ${claimed.starterId}::uuid
        `);
      }
    } catch (error) {
      // The hold runs out by itself, and the pack is taken again then.
      console.error("[pack-pictures] the outcome could not be kept:", error);
      break;
    }
  }
  return result;
}
