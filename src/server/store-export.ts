import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * The whole store as one file to take away (wave 10 unit P, D377; PSI DATA-05): its website (pages and articles with their drafts, menus,
 * categories and tags, blogs, content types and entries, saved parts, page places and redirects), its look (the live theme, every installed
 * theme's look and the site's CSS, cookie notes, the chat agent and its documents, A/B tests) and its settings (the store's own row, countries,
 * currencies, tax profile, shipping and customs, prices per country, payment methods, returns, orders, order rules and workflows, checkout
 * rules, notifications and email texts, automations, discounts and campaigns, bonus, affiliates and creators, price lists, customer groups,
 * segments, search merchandising, recommendations, analytics targets and saved reports, alerts, support, the autopilot and Work), as JSON.
 * Products, inventory, orders and customers have their own CSV files (D165), which the page links; this file holds no person's data beyond
 * what the store wrote into its own pages and settings. Nothing that opens a door goes in it: every column named like a secret, token,
 * hash, password, key or encrypted value is left out (`SECRET_COLUMN`), and a discount code's named customers too. The owner's (as the
 * order and customer files are), audited `store.exported` with the counts. The only reader that gathers this.
 */

/** The tables the file holds, each the store's rows (`store_id`), in the order the file lists them. A new store-owned table of settings or site goes here. */
export const STORE_EXPORT_TABLES = [
  "pages",
  "page_roles",
  "page_redirects",
  "menus",
  "terms",
  "blogs",
  "blog_authors",
  "content_types",
  "content_entries",
  "saved_parts",
  "text_styles",
  "field_groups",
  "redirects",
  "not_found_ignored",
  "cookie_notes",
  "chat_agents",
  "knowledge_documents",
  "experiments",
  "experiment_variants",
  "store_theme_installs",
  "store_themes",
  "markets",
  "store_currencies",
  "store_tax_profile",
  "store_locations",
  "shipping_rates",
  "shipping_zones",
  "shipping_methods",
  "shipping_method_rates",
  "pickup_options",
  "local_delivery_areas",
  "return_settings",
  "order_settings",
  "checkout_rules",
  "checkout_fields",
  "notification_settings",
  "email_templates",
  "campaigns",
  "discount_codes",
  "customer_tiers",
  "segments",
  "search_synonyms",
  "search_rules",
  "shipping_settings",
  "shipping_profiles",
  "delivery_schedules",
  "customs_settings",
  "producer_registrations",
  "market_price_rules",
  "tax_rate_overrides",
  "payment_methods",
  "invoice_settings",
  "gift_card_settings",
  "review_settings",
  "order_rules",
  "order_views",
  "workflows",
  "automations",
  "cart_reminder_steps",
  "broadcast_templates",
  "bonus_settings",
  "bonus_rewards",
  "affiliate_settings",
  "creator_settings",
  "price_lists",
  "price_list_products",
  "price_list_prices",
  "price_list_breaks",
  "price_list_quantity_rules",
  "price_list_assignments",
  "recommendation_settings",
  "recommendation_rules",
  "analytics_settings",
  "analytics_targets",
  "saved_reports",
  "report_schedules",
  "staff_alert_settings",
  "support_settings",
  "support_replies",
  "autopilot_settings",
  "work_settings",
] as const;

/** A column that could open a door, never written to the file (the support inbox's channel and email-address keys among them). */
export const SECRET_COLUMN = /(secret|token|_hash$|^hash$|password|encrypt|credential|signing|api_key|private_key|webhook|^channel_key$|^email_key$)/i;

/** Columns that name a person (who made or changed a row, a code's named customers, a report's recipients), left out whatever the table. */
export const PERSON_COLUMN = /(_by$|^customer_ids$|^recipients$|(^|_)account_id$)/;

/** A row as it goes into the file: without its store id, its secrets or the people it names. */
export function exportable(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => key !== "store_id" && !SECRET_COLUMN.test(key) && !PERSON_COLUMN.test(key)));
}

export type StoreExport = { schema: "kaizen.store-export"; version: 1; exportedAt: string; store: Record<string, unknown>; tables: Record<string, Record<string, unknown>[]> };

/** The file (the owner's): every table's rows in one read-only snapshot. */
export async function storeExport(member: Membership): Promise<{ ok: true; filename: string; json: string } | { ok: false }> {
  if (!memberCan(member, "owner")) return { ok: false };
  const storeId = member.store.id;
  const file = await db().transaction(
    async (tx) => {
      const [store] = await tx.execute<Row>(sql`select to_jsonb(s) as row from commerce.stores s where s.id = ${storeId}::uuid`);
      const tables: Record<string, Record<string, unknown>[]> = {};
      for (const table of STORE_EXPORT_TABLES) {
        // The table's name comes from the fixed list above, never from a request.
        const rows = await tx.execute<Row>(sql`select to_jsonb(t) as row from ${sql.raw(`commerce.${table}`)} t where t.store_id = ${storeId}::uuid`);
        tables[table] = rows.map((r) => exportable(r.row as Record<string, unknown>));
      }
      const exported: StoreExport = { schema: "kaizen.store-export", version: 1, exportedAt: new Date().toISOString(), store: exportable((store?.row ?? {}) as Record<string, unknown>), tables };
      return exported;
    },
    { accessMode: "read only", isolationLevel: "repeatable read" },
  );
  const counts = Object.fromEntries(Object.entries(file.tables).map(([t, rows]) => [t, rows.length]));
  await audit(member.account.id, storeId, "store.exported", { counts }, { area: "settings" });
  return { ok: true, filename: `${member.store.slug}-store-${file.exportedAt.slice(0, 10)}.json`, json: JSON.stringify(file, null, 2) };
}
