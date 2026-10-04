import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LEGAL_ROLES } from "@/lib/legal-roles";
import { parsePageContent, type PageType } from "@/lib/page-content";
import { applyTranslated, translationItems, type TranslateMode } from "@/lib/page-translate-ai";
import { withTranslation } from "@/lib/page-translation";
import {
  fitsItem,
  isLegalPage,
  menuUnit,
  PRODUCT_FIELDS,
  productUnits,
  returnInstructionsUnit,
  type Accepted,
  type ProductField,
  type ProductTexts,
  type TranslateScope,
  type Unit,
} from "@/lib/store-translate";

import { audit, type Membership } from "./auth";
import { fieldWork, writeFieldUnit } from "./field-translate";
import { savePage } from "./pages";
import { getReturnSettings, getInstructionTranslations, saveInstructionTranslations } from "./return-settings";

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
});

async function productWork(storeId: string, from: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const rows = await db().execute<Row>(sql`
    select p.id,
      m.title, m.description, m.safety_information as safety, m.seo_title, m.seo_description,
      t.product_id is not null as has_target,
      t.title as t_title, t.description as t_description, t.safety_information as t_safety, t.seo_title as t_seo_title, t.seo_description as t_seo_description
    from commerce.products p
    join commerce.product_translations m on m.product_id = p.id and m.locale = ${from}
    left join commerce.product_translations t on t.product_id = p.id and t.locale = ${to}
    where p.store_id = ${storeId}::uuid and p.status <> 'archived'
    order by p.created_at, p.id
  `);
  return rows.flatMap((row) => {
    const target = row.has_target ? mainText(row, "t_") : null;
    return productUnits(String(row.id), mainText(row), target, mode);
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
  ]);
  const units = parts.flat();
  return { units: limit === null ? units : units.slice(0, limit), total: units.length };
}

/** How many things in each scope still lack a translation, by language: what the page shows before a run. */
export async function translationCoverage({ store }: Pick<Membership, "store">): Promise<Record<string, Record<TranslateScope, number>>> {
  const others = store.localization.locales.slice(1);
  const rows = await Promise.all(
    others.map(async (locale) => {
      const { units } = await translationWorklist({ store }, locale, ["products", "menus", "pages", "fields", "returns"], "missing", null);
      const count: Record<TranslateScope, number> = { products: 0, menus: 0, pages: 0, fields: 0, returns: 0 };
      for (const unit of units) count[unit.scope] += 1;
      return [locale, count] as const;
    }),
  );
  return Object.fromEntries(rows);
}

export type ApplyResult = { ok: true; saved: number; skipped: string[] } | { ok: false; problem: string };

const APPLY_LIMIT = 300;
const SCOPE_OF: Record<string, TranslateScope> = { product: "products", menu: "menus", page: "pages", fielddef: "fields", fieldval: "fields", returns: "returns" };

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
    } else if (unit.scope === "returns") {
      const text = String(ok.instructions ?? "").trim();
      if (!text) {
        skipped.push(`${unit.title}: nothing usable to save.`);
        continue;
      }
      // The other languages' texts are kept: only this language's is replaced.
      const kept = await getInstructionTranslations(store.id);
      const result = await saveInstructionTranslations(store.id, { ...kept, [to]: text }, store.localization.locales.slice(1), member.account.id);
      if (result.ok) saved += 1;
      else skipped.push(`${unit.title}: ${result.problems[0]}`);
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
  await audit(member.account.id, store.id, "store.ai_translated", { to, saved, skipped: skipped.length });
  return { ok: true, saved, skipped };
}

async function writeProduct(storeId: string, productId: string, from: string, to: string, texts: Partial<ProductTexts>): Promise<boolean> {
  const [existing] = await db().execute<Row>(sql`
    select t.title, t.description, t.safety_information as safety, t.seo_title, t.seo_description
    from commerce.product_translations t where t.product_id = ${productId}::uuid and t.store_id = ${storeId}::uuid and t.locale = ${to}
  `);
  const [source] = await db().execute<Row>(sql`
    select 1 from commerce.product_translations where product_id = ${productId}::uuid and store_id = ${storeId}::uuid and locale = ${from}
  `);
  if (!source) return false;
  const current = existing ? mainText(existing) : null;
  const next = Object.fromEntries(PRODUCT_FIELDS.map((f) => [f.key, texts[f.key as ProductField] ?? current?.[f.key as ProductField] ?? ""])) as ProductTexts;
  // A translation needs a title, so the rest of it cannot be kept without one.
  if (next.title.trim() === "") return false;
  await db().execute(sql`
    insert into commerce.product_translations (store_id, product_id, locale, title, description, safety_information, seo_title, seo_description)
    values (${storeId}::uuid, ${productId}::uuid, ${to}, ${next.title}, ${next.description}, ${next.safetyInformation}, ${next.seoTitle}, ${next.seoDescription})
    on conflict (product_id, locale) do update set
      title = excluded.title, description = excluded.description, safety_information = excluded.safety_information,
      seo_title = excluded.seo_title, seo_description = excluded.seo_description
  `);
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
