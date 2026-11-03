import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { BULK_MAX_PRODUCTS } from "@/lib/data-limits";
import { isoCountries } from "@/lib/iso-countries";
import { operatorSchema } from "@/lib/product-input";
import { chunks, makerGroups, type MakerGroup } from "@/lib/shopify-makers";

import type { Membership } from "./auth";
import { continueBulk, startBulk, type BulkProgress } from "./bulk-edit";
import { log } from "./log";
import { memberCan } from "./permissions";
import { pgTextArray } from "./pg-arrays";
import { chooseOperator, type Operator } from "./products";
import { copiedVendors, type CopyDeps } from "./shopify-copy";
import { listCountries } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * *Who makes your products?* (D445 step 6, `docs/moving-from-shopify.md` 4.5): the copied products without a manufacturer, one question per
 * Shopify vendor. The owner's *Yes* (or *someone else*) names the economic operator, kept as the product editor keeps one, and the products
 * get it through the bulk editor's own *Set the manufacturer* action (D165, its seven-day undo), then the ones that were on sale in Shopify
 * are published by its *Set status* action, whose save refuses one still missing something (a picture). Nothing here writes a product itself.
 */

const OWNER = "owner" as const;

const HERE = z.object({ id: col.uuid, handle: col.text, manufacturer_id: col.uuid.nullable(), status: z.enum(["draft", "active", "archived"]) });
const OPERATOR = z.object({ id: col.uuid, name: col.text, postal_address: col.text, electronic_address: col.text, country: col.text });

async function groupsOf(member: Membership, deps: CopyDeps): Promise<MakerGroup[]> {
  const lines = await copiedVendors(member, deps);
  if (lines.length === 0) return [];
  const handles = [...new Set(lines.map((l) => l.handle))];
  const here = await typedRows(
    HERE,
    sql`select id, handle, manufacturer_id, status::text as status from commerce.products
         where store_id = ${member.store.id}::uuid and handle = any(${pgTextArray(handles)}::text[])`,
  );
  return makerGroups(
    lines,
    here.map((p) => ({ id: p.id, handle: p.handle, manufacturerId: p.manufacturer_id, status: p.status })),
  );
}

export type MakersView = {
  groups: { vendor: string; count: number; toPublish: number }[];
  operators: Operator[];
  countries: { code: string; name: string }[];
  euCountries: string[];
};

/** The screen (owner only): each vendor with products still to name a maker for, the store's companies, and the countries to choose from. */
export async function makersView(member: Membership, deps: CopyDeps = {}): Promise<MakersView | null> {
  if (!memberCan(member, OWNER)) return null;
  const groups = await groupsOf(member, deps);
  if (groups.length === 0) return { groups: [], operators: [], countries: [], euCountries: [] };
  const [operators, countries] = await Promise.all([
    typedRows(OPERATOR, sql`select id, name, postal_address, electronic_address, country from commerce.economic_operators where store_id = ${member.store.id}::uuid order by name`),
    listCountries(),
  ]);
  return {
    groups: groups.map((g) => ({ vendor: g.vendor, count: g.productIds.length, toPublish: g.publishIds.length })),
    operators: operators.map((o) => ({ id: o.id, name: o.name, postalAddress: o.postal_address, electronicAddress: o.electronic_address, country: o.country })),
    // A maker may be anywhere in the world (the product editor's own list); the EU's from the database.
    countries: isoCountries(),
    euCountries: countries.filter((c) => c.inEu).map((c) => c.code),
  };
}

const makerInput = z.object({
  vendor: z.string().max(255),
  manufacturer: operatorSchema.refine((c) => c !== null),
  responsible: operatorSchema.default(null),
});

export type MakerSaved =
  | { ok: true; named: number; published: number; notPublished: number }
  | { ok: false; problem: "invalid" | "responsible" | "gone" | "failed" };

/** Runs one bulk action to its end (each run goes until its time is up; a larger one is taken on again), at most a few runs. */
async function runToEnd(member: Membership, first: BulkProgress): Promise<BulkProgress> {
  let progress = first;
  for (let i = 0; i < 20 && progress.ok && !progress.done; i += 1) progress = await continueBulk(member, progress.batchId);
  return progress;
}

/** How many of a finished batch's products changed. */
async function changedOf(member: Membership, batchId: string): Promise<number> {
  const [row] = await typedRows(
    z.object({ n: col.int }),
    sql`select count(distinct product_id)::int as n from commerce.bulk_edit_items where store_id = ${member.store.id}::uuid and batch_id = ${batchId}::uuid and outcome = 'changed'`,
  );
  return row?.n ?? 0;
}

/**
 * The owner's answer for one vendor: the company named (an existing one, or added), the products of that vendor still without a maker get it,
 * and the ones Shopify had on sale are published where nothing else is missing. A manufacturer outside the EU needs a responsible person in it.
 */
export async function saveVendorMaker(member: Membership, raw: unknown, deps: CopyDeps = {}): Promise<MakerSaved> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "failed" };
  const parsed = makerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const { vendor, manufacturer, responsible } = parsed.data;
  const group = (await groupsOf(member, deps)).find((g) => g.vendor === vendor);
  if (!group) return { ok: false, problem: "gone" };
  const countries = await listCountries();
  const eu = new Set(countries.filter((c) => c.inEu).map((c) => c.code));
  const operators = await typedRows(OPERATOR, sql`select id, name, postal_address, electronic_address, country from commerce.economic_operators where store_id = ${member.store.id}::uuid`);
  const countryOf = (choice: z.infer<typeof operatorSchema>): string | null =>
    choice === null ? null : "id" in choice ? (operators.find((o) => o.id === choice.id)?.country ?? null) : choice.new.country;
  const makerCountry = countryOf(manufacturer);
  if (makerCountry === null) return { ok: false, problem: "invalid" };
  const needsResponsible = !eu.has(makerCountry);
  if (needsResponsible && !eu.has(countryOf(responsible) ?? "")) return { ok: false, problem: "responsible" };

  let manufacturerId: string | null;
  let responsibleId: string | null;
  try {
    manufacturerId = await chooseOperator(member.store.id, manufacturer);
    responsibleId = needsResponsible ? await chooseOperator(member.store.id, responsible) : null;
  } catch (error) {
    log("warn", "shopify.makers_operator_refused", { storeId: member.store.id }, error);
    return { ok: false, problem: "invalid" };
  }
  if (!manufacturerId) return { ok: false, problem: "invalid" };

  let named = 0;
  for (const productIds of chunks(group.productIds, BULK_MAX_PRODUCTS)) {
    const done = await runToEnd(member, await startBulk(member, { action: "manufacturer", productIds, manufacturerId, responsibleId }));
    if (!done.ok) return { ok: false, problem: "failed" };
    named += await changedOf(member, done.batchId);
  }
  // Only the ones that now have their maker: a product the first action could not change stays a draft.
  const stillWithout = new Set((await groupsOf(member, deps)).flatMap((g) => g.productIds));
  const publish = group.publishIds.filter((id) => !stillWithout.has(id));
  let published = 0;
  for (const productIds of chunks(publish, BULK_MAX_PRODUCTS)) {
    const done = await runToEnd(member, await startBulk(member, { action: "status", productIds, to: "active" }));
    if (done.ok) published += await changedOf(member, done.batchId);
  }
  log("info", "shopify.makers_named", { storeId: member.store.id, named, published });
  return { ok: true, named, published, notPublished: publish.length - published };
}
