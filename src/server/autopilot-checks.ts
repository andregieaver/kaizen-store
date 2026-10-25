import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { StepCheck } from "@/lib/autopilot-plans";

import type { Account } from "./auth";
import { isDemoProduct } from "./demo-content";
import { lookOutcome, type LookDeps } from "./page-looks";
import { getSetupProgress } from "./setup";
import { currentStore, type Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * Whether a step of the autopilot worked (D309, `docs/ai-autopilot.md` 7.2), read by code from the store's own data after the step ran,
 * never from what the model says it did. A page is published only past the builder's accessibility check (`publish_page` refuses a
 * blocking issue), so "published" carries it.
 */

export type CheckOutcome = { ok: true } | { ok: false; problem: string };

const COUNT = z.object({ n: col.int });
const scoped = (store: Store | null, column = sql`store_id`) => (store ? sql`${column} = ${store.id}::uuid` : sql`${column} is null`);

export type CheckOptions = {
  /** Who the step runs for: a page check that looks (D310) asks for the look in their name. */
  account?: Account;
  look?: LookDeps;
};

export async function checkStep(store: Store | null, check: StepCheck, options: CheckOptions = {}): Promise<CheckOutcome> {
  switch (check.kind) {
    case "none":
      return { ok: true };
    case "product": {
      if (!store) return { ok: false, problem: "Kaizena Flow's own site has no products." };
      const row = await typedRow(
        COUNT,
        sql`select count(*)::int as n from commerce.products p
          where p.store_id = ${store.id}::uuid and p.status <> 'archived' ${check.active ? sql`and p.status = 'active'` : sql``}
            and exists (select 1 from commerce.product_translations t where t.product_id = p.id and lower(t.title) = lower(${check.title}))`,
      );
      return (row?.n ?? 0) > 0 ? { ok: true } : { ok: false, problem: `No ${check.active ? "active " : ""}product called "${check.title}" was found.` };
    }
    case "page": {
      const named = check.slug
        ? sql`slug = ${check.slug.replace(/^\//, "")}`
        : sql`(lower(coalesce(published ->> 'title', '')) = lower(${check.title ?? ""}) or lower(coalesce(draft ->> 'title', '')) = lower(${check.title ?? ""}))`;
      const row = await typedRow(
        z.object({ id: col.uuid }),
        sql`select id from commerce.pages where ${scoped(store)} and type in ('page', 'article') and ${named}
          ${check.published ? sql`and published is not null` : sql``} order by updated_at desc limit 1`,
      );
      if (!row) return { ok: false, problem: `No ${check.published ? "published " : ""}page "${check.slug ?? check.title}" was found.` };
      // A look at the page's draft (D310, `docs/ai-autopilot.md` 9.5): a store's pages only.
      if (check.looks && store && options.account) return lookOutcome((await currentStore(store.slug)) ?? store, options.account, row.id, options.look);
      return { ok: true };
    }
    case "setup_step": {
      if (!store) return { ok: false, problem: "Kaizena Flow's own site has no setup." };
      const progress = await getSetupProgress((await currentStore(store.slug)) ?? store);
      return progress[check.step] ? { ok: true } : { ok: false, problem: `The setup step "${check.step}" is not done yet.` };
    }
    case "store_open": {
      if (!store) return { ok: false, problem: "Kaizena Flow's own site is always open." };
      const row = await typedRow(z.object({ open: col.bool }), sql`select setup_completed_at is not null as open from commerce.stores where id = ${store.id}::uuid`);
      return row?.open ? { ok: true } : { ok: false, problem: "The store is not open yet." };
    }
    case "count": {
      const row =
        check.what === "products"
          ? store
            ? await typedRow(COUNT, sql`select count(*)::int as n from commerce.products p where p.store_id = ${store.id}::uuid and p.status = 'active' and not ${isDemoProduct(sql`p`)}`)
            : { n: 0 }
          : await typedRow(COUNT, sql`select count(*)::int as n from commerce.pages where ${scoped(store)} and type = 'page' and published is not null`);
      const n = row?.n ?? 0;
      return n >= check.at_least ? { ok: true } : { ok: false, problem: `There are ${n} ${check.what === "products" ? "active products" : "published pages"}, not yet ${check.at_least}.` };
    }
  }
}
