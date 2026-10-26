import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LEGAL_ROLES } from "@/lib/legal-roles";
import { parsePageContent, type PageType } from "@/lib/page-content";
import { applyTranslated, translationItems, withRichRuns, type TranslateMode } from "@/lib/page-translate-ai";
import { withTranslation } from "@/lib/page-translation";
import {
  emailUnit,
  EMAIL_SLOTS,
  fitsItem,
  isLegalPage,
  mediaKeyPosition,
  menuUnit,
  PRODUCT_FIELDS,
  productUnits,
  returnInstructionsUnit,
  samePlaceholders,
  shippingUnit,
  termUnit,
  type Accepted,
  type MediaTexts,
  type ProductField,
  type ProductTexts,
  type TranslateScope,
  type Unit,
} from "@/lib/store-translate";

import { INFO_MAX, INSTRUCTIONS_MAX, NAME_MAX } from "@/lib/shipping-limits";
import { parseTermSeo, termSeoFor, termSeoInput, type TermSeo } from "@/lib/term-seo";
import { parseTermDescription, parseTermTexts, termTextsInput, type TermTexts } from "@/lib/term-texts";

import { audit, type Membership } from "./auth";
import { fieldWork, writeFieldUnit } from "./field-translate";
import { getTemplate, listNotifications, saveTemplate, templateLocale } from "./notifications";
import { savePage } from "./pages";
import { refreshTag } from "./refresh";
import { getReturnSettings, getInstructionTranslations, saveInstructionTranslations } from "./return-settings";
import { termsTag } from "./taxonomy";

type Row = Record<string, unknown>;

/**
 * Translating a whole store (D110): finds what has no translation in a
 * language yet, or everything again, and writes what staff accepted. Nothing
 * here calls the model; the page's own translate action does (batch by
 * batch, from the browser, so a large catalogue never waits on one request).
 * Writes go where the store's own editors write: product translations, the
 * menus' link texts, the pages' drafts, which are not published, and custom
 * fields' labels and values (`field-translate.ts`).
 */

/** The most things one run brings, so the review stays readable; run again for the rest. */
export const WORKLIST_LIMIT = 100;

export type Worklist = { units: Unit[]; /** How many there were before the limit. */ total: number };

const main = (member: Pick<Membership, "store">) => member.store.localization.locales[0];

const mainText = (row: Row, prefix = ""): ProductTexts => ({
  title: String(row[`${prefix}title`] ?? ""),
  description: String(row[`${prefix}description`] ?? ""),
  safetyInformation: String(row[`${prefix}safety`] ?? ""),
  seoTitle: String(row[`${prefix}seo_title`] ?? ""),
  seoDescription: String(row[`${prefix}seo_description`] ?? ""),
  excerpt: String(row[`${prefix}excerpt`] ?? ""),
});

async function productWork(storeId: string, from: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const rows = await db().execute<Row>(sql`
    select p.id,
      m.title, m.description, m.safety_information as safety, m.seo_title, m.seo_description, m.excerpt,
      t.product_id is not null as has_target,
      t.title as t_title, t.description as t_description, t.safety_information as t_safety, t.seo_title as t_seo_title, t.seo_description as t_seo_description, t.excerpt as t_excerpt
    from commerce.products p
    join commerce.product_translations m on m.product_id = p.id and m.locale = ${from}
    left join commerce.product_translations t on t.product_id = p.id and t.locale = ${to}
    where p.store_id = ${storeId}::uuid and p.status <> 'archived'
    order by p.created_at, p.id
  `);
  // The gallery items' words (D325): what the owner wrote in the main language, and the target language's unless it is the title filled in.
  const media = await db().execute<Row>(sql`
    select pm.product_id, pm.position, pm.kind, pm.alt ->> ${from} as source, pm.alt ->> ${to} as target
    from commerce.product_media pm join commerce.products p on p.id = pm.product_id
    where pm.store_id = ${storeId}::uuid and p.status <> 'archived'
    order by pm.product_id, pm.position
  `);
  const byProduct = new Map<string, MediaTexts[]>();
  for (const row of rows) byProduct.set(String(row.id), []);
  const titles = new Map(rows.map((row) => [String(row.id), { from: String(row.title ?? ""), to: String(row.t_title ?? "") }]));
  for (const m of media) {
    const list = byProduct.get(String(m.product_id));
    const title = titles.get(String(m.product_id));
    if (!list || !title) continue;
    const source = String(m.source ?? "");
    const target = String(m.target ?? "");
    list.push({
      position: Number(m.position),
      kind: m.kind === "video" || m.kind === "model" ? m.kind : "image",
      source: source === title.from ? "" : source,
      target: target === title.to || target === title.from ? "" : target,
    });
  }
  return rows.flatMap((row) => {
    const target = row.has_target ? mainText(row, "t_") : null;
    return productUnits(String(row.id), mainText(row), target, mode, byProduct.get(String(row.id)) ?? []);
  });
}

async function menuWork(storeId: string, from: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const menus = await db().execute<Row>(sql`select id, name, items from commerce.menus where store_id = ${storeId}::uuid order by name`);
  return menus.flatMap((menu) =>
    ((menu.items ?? []) as { label?: Record<string, string> }[]).flatMap((item, index) => {
      const unit = menuUnit(String(menu.id), String(menu.name), index, item.label ?? {}, from, to, mode);
      return unit ? [unit] : [];
    }),
  );
}

async function pageWork(storeId: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const rows = await db().execute<Row>(sql`
    select id, type, slug, draft from commerce.pages
    where store_id = ${storeId}::uuid and type in ('page', 'article') order by type, updated_at desc
  `);
  // A page the store chose for a legal role (terms, privacy, …) is a legal text whatever it is called (wave 1, 1e).
  const roles = await db().execute<Row>(sql`
    select page_id from commerce.page_roles
    where store_id = ${storeId}::uuid and role = any(${sql.raw(`array[${LEGAL_ROLES.map((r) => `'${r}'`).join(", ")}]::text[]`)})
  `);
  const held = new Set(roles.map((r) => String(r.page_id)));
  return rows.flatMap((row) => {
    const content = parsePageContent(row.draft);
    if (!content) return [];
    const items = translationItems(content, to, mode);
    if (items.length === 0) return [];
    return [
      {
        id: `page:${row.id}`,
        scope: "pages" as const,
        title: content.title || String(row.slug),
        kind: row.type === "article" ? "Article" : "Page",
        legal: isLegalPage(String(row.slug), content.title, held.has(String(row.id))),
        items,
      },
    ];
  });
}

/** The store's return instructions (D153), when they have words and the language has none yet. */
async function returnsWork(storeId: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const [settings, translations] = await Promise.all([getReturnSettings(storeId), getInstructionTranslations(storeId)]);
  const unit = returnInstructionsUnit(settings.instructions, translations[to] ?? null, mode);
  return unit ? [unit] : [];
}

/**
 * The store's product categories and tags: their names and descriptions (wave 6 unit A, D319: the term's own columns are the main language, `texts` the
 * others) and their search titles and descriptions (wave 2, D168), listed where the other language has none (or all of them again). Never legal.
 */
async function termWork(storeId: string, from: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const rows = await db().execute<Row>(sql`
    select id, kind, name, seo, description, texts from commerce.terms
    where store_id = ${storeId}::uuid and content_type = 'product' order by kind, lower(name), id
  `);
  return rows.flatMap((row) => {
    const seo = parseTermSeo(row.seo);
    const own = parseTermTexts(row.texts)[to];
    const page = {
      name: { source: String(row.name), target: own?.name ?? null },
      description: { source: parseTermDescription(row.description), target: own?.description ?? null },
    };
    const unit = termUnit(String(row.id), String(row.name), row.kind === "tag" ? "tag" : "category", termSeoFor(seo, from), termSeoFor(seo, to), mode, page);
    return unit ? [unit] : [];
  });
}

const textIn = (texts: unknown, locale: string): string | null => {
  const value = texts && typeof texts === "object" ? (texts as Record<string, unknown>)[locale] : undefined;
  return typeof value === "string" ? value : null;
};

/**
 * The store's shipping texts (D237): methods' names, pickup places' instructions, local areas' names and delivery information, from the main language (the
 * row's own column) into `to` (its texts by locale). Listed where the language has none (or all of them again).
 */
async function shippingWork(storeId: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const [methods, pickups, areas] = await Promise.all([
    db().execute<Row>(sql`select id, name, names, market_code from commerce.shipping_methods where store_id = ${storeId}::uuid order by market_code, position, id`),
    db().execute<Row>(sql`
      select po.id, po.instructions, po.instructions_t, l.name from commerce.pickup_options po
      join commerce.store_locations l on l.store_id = po.store_id and l.id = po.location_id
      where po.store_id = ${storeId}::uuid order by po.position, po.id
    `),
    db().execute<Row>(sql`select id, name, names, info, info_t from commerce.local_delivery_areas where store_id = ${storeId}::uuid order by market_code, position, id`),
  ]);
  const units = [
    ...methods.map((m) =>
      shippingUnit("method", String(m.id), `${String(m.name)} (${String(m.market_code).trim()})`, [{ key: "name", label: "Name", max: NAME_MAX, source: String(m.name), target: textIn(m.names, to) }], mode),
    ),
    ...pickups.map((p) =>
      shippingUnit("pickup", String(p.id), String(p.name), [{ key: "instructions", label: "Pickup instructions", max: INSTRUCTIONS_MAX, source: String(p.instructions ?? ""), target: textIn(p.instructions_t, to) }], mode),
    ),
    ...areas.map((a) =>
      shippingUnit(
        "area",
        String(a.id),
        String(a.name),
        [
          { key: "name", label: "Name", max: NAME_MAX, source: String(a.name), target: textIn(a.names, to) },
          { key: "info", label: "Delivery information", max: INFO_MAX, source: String(a.info ?? ""), target: textIn(a.info_t, to) },
        ],
        mode,
      ),
    ),
  ];
  return units.filter((u): u is Unit => u !== null);
}

/** Writes accepted shipping texts in `to` beside the others (each table's texts by locale); the main language's own words are never changed. */
async function writeShippingUnit(storeId: string, unitId: string, to: string, ok: Record<string, string | string[]>): Promise<boolean> {
  const [kind, id] = unitId.split(":");
  const text = (key: string) => (typeof ok[key] === "string" ? String(ok[key]).trim() : "");
  const set = (column: string, key: string) => (text(key) ? sql`${sql.raw(column)} = ${sql.raw(column)} || jsonb_build_object(${to}::text, ${text(key)}::text)` : null);
  const parts =
    kind === "shipmethod" ? [set("names", "name")] : kind === "pickupopt" ? [set("instructions_t", "instructions")] : kind === "localarea" ? [set("names", "name"), set("info_t", "info")] : [];
  const changes = parts.filter((p): p is NonNullable<typeof p> => p !== null);
  if (changes.length === 0) return false;
  const table = kind === "shipmethod" ? sql`commerce.shipping_methods` : kind === "pickupopt" ? sql`commerce.pickup_options` : sql`commerce.local_delivery_areas`;
  const rows = await db().execute<Row>(sql`
    update ${table} set ${sql.join(changes, sql`, `)}, updated_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid returning id
  `);
  return rows.length > 0;
}

/**
 * The store's own words of its customer emails (D238): for each editable notification with a template in the main language, the parts it has, into `to`
 * (listed where `to` has no text of its own for a part, or all again). Nothing when the two languages keep their templates under the same language code.
 */
async function emailWork(storeId: string, from: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const source = templateLocale(from);
  const target = templateLocale(to);
  if (!source || !target || source === target) return [];
  const list = await listNotifications(storeId);
  const withWords = list.filter((n) => n.def.editable && n.languages.some((l) => l.lang === source && l.own));
  const units = await Promise.all(
    withWords.map(async (n) => {
      const [main, other] = await Promise.all([getTemplate(storeId, n.def.id, source), getTemplate(storeId, n.def.id, target)]);
      return emailUnit(n.def.id, n.def.label, main, other, mode);
    }),
  );
  return units.filter((u): u is Unit => u !== null);
}

/**
 * Writes an accepted email translation in `to` through the Notifications page's own save (`saveTemplate()`, which runs `templateProblems()` again: placeholders,
 * braces, web addresses and the claims filter), the language's other parts kept as they are. A part whose placeholders differ from the main language's is left out.
 */
async function writeEmailUnit(member: Membership, unitId: string, from: string, to: string, ok: Record<string, string | string[]>): Promise<true | string> {
  const id = unitId.slice("email:".length);
  const [source, current] = await Promise.all([getTemplate(member.store.id, id, from), getTemplate(member.store.id, id, to)]);
  if (!source) return "the main language's own words are gone.";
  const next = { subject: current?.subject ?? null, heading: current?.heading ?? null, body: current?.body ?? null };
  let changed = 0;
  for (const slot of EMAIL_SLOTS) {
    const value = ok[slot.key];
    const original = source[slot.key];
    if (typeof value !== "string" || !original) continue;
    if (!samePlaceholders(original, value)) return `the ${slot.label.toLowerCase()} does not keep the placeholders as written, so it was left out.`;
    next[slot.key] = value.trim();
    changed += 1;
  }
  if (changed === 0) return "nothing usable to save.";
  const result = await saveTemplate(member.store.id, id, to, next, member.account.id);
  return result.ok ? true : result.message;
}

/** What there is to translate into `to`, from the store's main language, in the scopes asked for. */
export async function translationWorklist(
  { store }: Pick<Membership, "store">,
  to: string,
  scopes: readonly TranslateScope[],
  mode: TranslateMode,
  limit: number | null = WORKLIST_LIMIT,
): Promise<Worklist> {
  const from = store.localization.locales[0];
  const parts = await Promise.all([
    scopes.includes("products") ? productWork(store.id, from, to, mode) : [],
    scopes.includes("menus") ? menuWork(store.id, from, to, mode) : [],
    scopes.includes("pages") ? pageWork(store.id, to, mode) : [],
    scopes.includes("fields") ? fieldWork(store.id, from, to, mode) : [],
    scopes.includes("returns") ? returnsWork(store.id, to, mode) : [],
    scopes.includes("terms") ? termWork(store.id, from, to, mode) : [],
    scopes.includes("shipping") ? shippingWork(store.id, to, mode) : [],
    scopes.includes("emails") ? emailWork(store.id, from, to, mode) : [],
  ]);
  const units = parts.flat();
  return { units: limit === null ? units : units.slice(0, limit), total: units.length };
}

/** How many things in each scope still lack a translation, by language: what the page shows before a run. */
export async function translationCoverage({ store }: Pick<Membership, "store">): Promise<Record<string, Record<TranslateScope, number>>> {
  const others = store.localization.locales.slice(1);
  const rows = await Promise.all(
    others.map(async (locale) => {
      const { units } = await translationWorklist({ store }, locale, ["products", "menus", "pages", "fields", "returns", "terms", "shipping", "emails"], "missing", null);
      const count: Record<TranslateScope, number> = { products: 0, menus: 0, pages: 0, fields: 0, returns: 0, terms: 0, shipping: 0, emails: 0 };
      for (const unit of units) count[unit.scope] += 1;
      return [locale, count] as const;
    }),
  );
  return Object.fromEntries(rows);
}

export type ApplyResult = { ok: true; saved: number; skipped: string[] } | { ok: false; problem: string };

const APPLY_LIMIT = 300;
const SCOPE_OF: Record<string, TranslateScope> = { product: "products", menu: "menus", page: "pages", fielddef: "fields", fieldval: "fields", returns: "returns", term: "terms", shipmethod: "shipping", pickupopt: "shipping", localarea: "shipping", email: "emails" };

/**
 * Writes what staff accepted, in the language `to`. Each accepted text is
 * checked against the store's own text again (it must be one asked for, in
 * the shape and length its place allows), whatever the browser sent.
 */
export async function applyTranslations(member: Membership, to: string, accepted: Accepted[]): Promise<ApplyResult> {
  const { store } = member;
  const from = main(member);
  if (!store.localization.locales.slice(1).includes(to)) return { ok: false, problem: "That is not one of the store's other languages." };
  if (accepted.length === 0) return { ok: true, saved: 0, skipped: [] };
  if (accepted.length > APPLY_LIMIT) return { ok: false, problem: `Save at most ${APPLY_LIMIT} at a time.` };

  const wanted = new Set(accepted.map((a) => a.unitId));
  const scopes = [...new Set(accepted.map((a) => SCOPE_OF[a.unitId.split(":")[0]]).filter(Boolean))];
  const work = await translationWorklist(member, to, scopes, "all", null);
  const units = new Map(work.units.filter((u) => wanted.has(u.id)).map((u) => [u.id, u]));

  const skipped: string[] = [];
  let saved = 0;
  const products = new Map<string, Partial<ProductTexts>>();
  const menus = new Map<string, { index: number; text: string }[]>();
  const terms = new Map<string, Partial<Record<"title" | "description", string>>>();
  for (const { unitId, values } of accepted) {
    const unit = units.get(unitId);
    if (!unit) {
      skipped.push("Something changed since it was found, so it was left out.");
      continue;
    }
    // Only texts the unit has, in the shape and length its place allows.
    const ok: Record<string, string | string[]> = {};
    for (const item of unit.items) {
      if (fitsItem(item, values[item.key])) ok[item.key] = values[item.key];
    }
    if (Object.keys(ok).length === 0) {
      skipped.push(`${unit.title}: nothing usable to save.`);
      continue;
    }
    if (unit.scope === "products") {
      const id = unitId.split(":")[1];
      products.set(id, { ...products.get(id), ...(ok as Partial<ProductTexts>) });
    } else if (unit.scope === "menus") {
      const [, menuId, index] = unitId.split(":");
      menus.set(menuId, [...(menus.get(menuId) ?? []), { index: Number(index), text: String(ok.label).trim() }]);
    } else if (unit.scope === "terms") {
      const id = unitId.split(":")[1];
      terms.set(id, { ...terms.get(id), ...(ok as Partial<TermAccepted>) });
    } else if (unit.scope === "returns") {
      const text = String(ok.instructions ?? "").trim();
      if (!text) {
        skipped.push(`${unit.title}: nothing usable to save.`);
        continue;
      }
      // The other languages' texts are kept: only this language's is replaced.
      const kept = await getInstructionTranslations(store.id);
      // Every language the store keeps besides the main one, those not shown now (D178) included.
      const others = store.localization.keptLocales.filter((locale) => locale !== store.localization.locales[0]);
      const result = await saveInstructionTranslations(store.id, { ...kept, [to]: text }, others, member.account.id);
      if (result.ok) saved += 1;
      else skipped.push(`${unit.title}: ${result.problems[0]}`);
    } else if (unit.scope === "shipping") {
      if (await writeShippingUnit(store.id, unitId, to, ok)) saved += 1;
      else skipped.push(`${unit.title}: nothing usable to save.`);
    } else if (unit.scope === "emails") {
      const result = await writeEmailUnit(member, unitId, from, to, ok);
      if (result === true) saved += 1;
      else skipped.push(`${unit.title}: ${result}`);
    } else if (unit.scope === "fields") {
      const result = await writeFieldUnit(member, unitId, to, ok);
      if (result === true) saved += 1;
      else skipped.push(`${unit.title}: ${result}`);
    } else {
      const id = unitId.split(":")[1];
      const result = await writePage(member, id, to, ok);
      if (result === true) saved += 1;
      else skipped.push(`${unit.title}: ${result}`);
    }
  }
  for (const [id, texts] of products) saved += (await writeProduct(store.id, id, from, to, texts)) ? 1 : 0;
  for (const [menuId, labels] of menus) saved += await writeMenuLabels(store.id, menuId, to, labels);
  for (const [id, texts] of terms) {
    const result = await writeTerm(member, id, from, to, texts);
    if (result === true) saved += 1;
    else skipped.push(result);
  }
  await audit(member.account.id, store.id, "store.ai_translated", { to, saved, skipped: skipped.length });
  return { ok: true, saved, skipped };
}

async function writeProduct(storeId: string, productId: string, from: string, to: string, texts: Partial<ProductTexts>): Promise<boolean> {
  const [existing] = await db().execute<Row>(sql`
    select t.title, t.description, t.safety_information as safety, t.seo_title, t.seo_description, t.excerpt
    from commerce.product_translations t where t.product_id = ${productId}::uuid and t.store_id = ${storeId}::uuid and t.locale = ${to}
  `);
  const [source] = await db().execute<Row>(sql`
    select 1 from commerce.product_translations where product_id = ${productId}::uuid and store_id = ${storeId}::uuid and locale = ${from}
  `);
  if (!source) return false;
  const current = existing ? mainText(existing) : null;
  const next = Object.fromEntries(PRODUCT_FIELDS.map((f) => [f.key, texts[f.key as ProductField] ?? current?.[f.key as ProductField] ?? ""])) as ProductTexts;
  // A gallery item's words in the language (D325), on the item at that position: they need no translated title.
  let wroteMedia = false;
  for (const [key, text] of Object.entries(texts)) {
    const position = mediaKeyPosition(key);
    if (position === null || typeof text !== "string" || text.trim() === "") continue;
    await db().execute(sql`
      update commerce.product_media set alt = alt || jsonb_build_object(${to}::text, ${text.trim()}::text)
      where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and position = ${position}
    `);
    wroteMedia = true;
  }
  // A translation needs a title, so the rest of it cannot be kept without one.
  if (next.title.trim() === "") return wroteMedia;
  await db().execute(sql`
    insert into commerce.product_translations (store_id, product_id, locale, title, description, safety_information, seo_title, seo_description, excerpt)
    values (${storeId}::uuid, ${productId}::uuid, ${to}, ${next.title}, ${next.description}, ${next.safetyInformation}, ${next.seoTitle}, ${next.seoDescription}, ${next.excerpt})
    on conflict (product_id, locale) do update set
      title = excluded.title, description = excluded.description, safety_information = excluded.safety_information,
      seo_title = excluded.seo_title, seo_description = excluded.seo_description, excerpt = excluded.excerpt
  `);
  return true;
}

/** What staff accepted of a term's unit: its name, its description as runs, its search title and description. */
type TermAccepted = { name: string; body: string[]; title: string; description: string };

/**
 * Puts the accepted texts of a category or tag in the language `to`: its name and description into `texts` (D319) and its search texts into `seo` (D168),
 * only the fields accepted, the rest (other languages' too) kept as they are, checked against the store's languages and the lengths again. A term that is
 * not the store's is left out, and so is a search text whose main-language text is gone. The suggestion was read and ticked by a person before it got here.
 */
async function writeTerm(member: Membership, termId: string, from: string, to: string, texts: Partial<TermAccepted>): Promise<true | string> {
  const { store } = member;
  const [row] = await db().execute<Row>(sql`
    select name, seo, description, texts from commerce.terms where id = ${termId}::uuid and store_id = ${store.id}::uuid and content_type = 'product'
  `);
  if (!row) return "A category or tag was gone, so it was left out.";
  const seo = parseTermSeo(row.seo);
  let nextSeo: TermSeo = seo;
  if (texts.title !== undefined || texts.description !== undefined) {
    if (!termSeoFor(seo, from)) return `${String(row.name)}: the main language has no search text any more.`;
    const current = termSeoFor(seo, to);
    const next: TermSeo = { ...seo, [to]: { title: texts.title ?? current?.title ?? "", description: texts.description ?? current?.description ?? "" } };
    const checked = termSeoInput(store.localization.locales).safeParse(next);
    if (!checked.success) return `${String(row.name)}: ${checked.error.issues[0]?.message ?? "the text could not be saved."}`;
    nextSeo = checked.data;
  }
  const pageTexts = parseTermTexts(row.texts);
  let nextTexts: TermTexts = pageTexts;
  if (texts.name !== undefined || texts.body !== undefined) {
    const own = pageTexts[to] ?? {};
    const source = parseTermDescription(row.description);
    const body = texts.body === undefined ? own.description : source ? (withRichRuns(source, texts.body) ?? undefined) : undefined;
    if (texts.body !== undefined && !body) return `${String(row.name)}: the description changed since it was translated, so it was left out.`;
    const raw = { ...pageTexts, [to]: { name: texts.name?.trim() || own.name, description: body } };
    const checked = termTextsInput(store.localization.keptLocales, store.localization.locales[0] ?? "").safeParse(raw);
    if (!checked.success) return `${String(row.name)}: ${checked.error.issues[0]?.message ?? "the text could not be saved."}`;
    nextTexts = checked.data;
  }
  await db().execute(sql`
    update commerce.terms set seo = ${JSON.stringify(nextSeo)}::jsonb, texts = ${JSON.stringify(nextTexts)}::jsonb, updated_at = now()
    where id = ${termId}::uuid and store_id = ${store.id}::uuid and content_type = 'product'
  `);
  refreshTag(termsTag({ storeId: store.id, contentType: "product" }));
  return true;
}

async function writeMenuLabels(storeId: string, menuId: string, to: string, labels: { index: number; text: string }[]): Promise<number> {
  const [menu] = await db().execute<Row>(sql`select items from commerce.menus where id = ${menuId}::uuid and store_id = ${storeId}::uuid`);
  if (!menu) return 0;
  // The items as stored, so nothing a newer editor keeps in them is lost.
  const items = (menu.items ?? []) as { label?: Record<string, string> }[];
  let count = 0;
  for (const { index, text } of labels) {
    const item = items[index];
    if (!item) continue;
    item.label = { ...(item.label ?? {}), [to]: text };
    count += 1;
  }
  if (count > 0) {
    await db().execute(sql`update commerce.menus set items = ${JSON.stringify(items)}::jsonb, updated_at = now() where id = ${menuId}::uuid and store_id = ${storeId}::uuid`);
  }
  return count;
}

/** Puts translated texts in a page's draft, through the page editor's own save, so the page is checked as always; it is not published. */
async function writePage(member: Membership, pageId: string, to: string, done: Record<string, string | string[]>): Promise<true | string> {
  const [row] = await db().execute<Row>(sql`
    select id, type, draft from commerce.pages where id = ${pageId}::uuid and store_id = ${member.store.id}::uuid and type in ('page', 'article')
  `);
  const content = row && parsePageContent(row.draft);
  if (!row || !content) return "The page is gone.";
  const translation = applyTranslated(content, content.translations?.[to] ?? {}, done);
  const result = await savePage(member.account, member.store.id, pageId, withTranslation(content, to, translation), {
    publish: false,
    type: String(row.type) as PageType,
  });
  return result.ok ? true : result.problems[0];
}
