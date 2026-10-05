// Test support for the integration tests of redirects (wave 2, second run, D168): a store with its own live product, category, tag, page and article, members
// with and without the Website keys, and plain helpers to rename. Not imported by the app.
import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import type { Account, Membership } from "./auth";
import { seedProducts } from "./data-test-support";
import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";
import { getStore } from "./stores";

type Row = Record<string, unknown>;

export type RedirectFixture = {
  fx: Fixture;
  owner: Membership;
  /** May read the redirects and the 404 report but change nothing. */
  reader: Membership;
  /** A member with neither Website key (a products role). */
  outsider: Membership;
  /** An active product with a price in Norway: `/p/{handle}`. */
  product: { id: string; handle: string };
  category: { id: string; slug: string };
  tag: { id: string; slug: string };
};

/** Adds a member with an exact set of permission keys (a custom role: the enum `admin` with keys). */
async function memberWith(fx: Fixture, label: string, permissions: string[]): Promise<Membership> {
  const email = `${label}-${fx.slug}@example.com`;
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, ${label}) returning id`);
  const account: Account = { id: String(row.id), email, name: label, platformAdmin: false };
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${fx.storeId}::uuid, ${account.id}::uuid, 'admin')`);
  return { account, store: (await getStore(fx.slug))!, role: "admin", permissions };
}

export async function addTerm(storeId: string, kind: "category" | "tag", slug: string, name = slug, parentId: string | null = null): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id) values (${storeId}::uuid, 'product', ${kind}, ${name}, ${slug}, ${parentId}::uuid) returning id
  `);
  return String(row.id);
}

/** A store of its own with the things a redirect is checked against; `label` makes its slug. */
export async function redirectFixture(label: string): Promise<RedirectFixture> {
  const fx = await makeStore(label);
  const owner = await ownerOf(fx);
  const [product] = await seedProducts(fx, 1, { prefix: `rd${fx.slug.replace(/[^a-z0-9]/g, "").slice(-8)}` });
  const category = { id: "", slug: `kat-${fx.slug.slice(-6)}` };
  const tag = { id: "", slug: `tag-${fx.slug.slice(-6)}` };
  category.id = await addTerm(fx.storeId, "category", category.slug, "Kategori");
  tag.id = await addTerm(fx.storeId, "tag", tag.slug, "Merke");
  return {
    fx,
    owner,
    reader: await memberWith(fx, "reader", ["website:read"]),
    outsider: await memberWith(fx, "outsider", ["products:write"]),
    product: { id: product.id, handle: product.handle },
    category,
    tag,
  };
}

export async function renameProduct(storeId: string, productId: string, handle: string): Promise<void> {
  await db().execute(sql`update commerce.products set handle = ${handle} where store_id = ${storeId}::uuid and id = ${productId}::uuid`);
}

export async function renameTerm(storeId: string, termId: string, slug: string): Promise<void> {
  await db().execute(sql`update commerce.terms set slug = ${slug} where store_id = ${storeId}::uuid and id = ${termId}::uuid`);
}

/** The redirects of a store by source, for assertions: kind and target. */
export async function redirectRowsOf(storeId: string): Promise<Row[]> {
  return db().execute<Row>(sql`select id, kind, source, target, origin, hits, product_id, term_id from commerce.redirects where store_id = ${storeId}::uuid order by source`);
}

export async function auditActions(storeId: string, prefix: string): Promise<Row[]> {
  return db().execute<Row>(sql`select action, details, area, target_type from commerce.audit_log where store_id = ${storeId}::uuid and action like ${`${prefix}%`} order by id`);
}

/** What a route's `permanentRedirect()` or `notFound()` threw: the status and the address, or `not-found`. */
export async function outcomeOf(promise: Promise<unknown>): Promise<{ status: 308; location: string } | { status: 404 } | { status: "returned" }> {
  try {
    await promise;
    return { status: "returned" };
  } catch (error) {
    const digest = String((error as { digest?: unknown })?.digest ?? "");
    const redirect = /^NEXT_REDIRECT;(?:replace|push);(.*);(\d+);?$/.exec(digest);
    if (redirect) return { status: Number(redirect[2]) as 308, location: redirect[1] } as { status: 308; location: string };
    if (digest.includes("NEXT_HTTP_ERROR_FALLBACK;404") || digest === "NEXT_NOT_FOUND") return { status: 404 };
    throw error;
  }
}
