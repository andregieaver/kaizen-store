import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db } from "@/db/client";
import { toMarket, type Market } from "@/lib/markets";
import { isStoreSlug } from "@/lib/paths";

export type StoreStatus = "active" | "suspended" | "closed";

export type Store = {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
  isTemplate: boolean;
  setupCompletedAt: string | null;
  /** The business behind the store, shown to shoppers. */
  details: StoreDetails;
  /** Active markets, the store's own country first. */
  markets: Market[];
};

export type StoreDetails = {
  legalName: string | null;
  organisationNumber: string | null;
  contactEmail: string | null;
  postalAddress: string | null;
  country: string | null;
};

export type Country = { code: string; name: string; currency: string; inEu: boolean };

/** Revalidate after changing a store's name, status or markets. */
export const storeTag = (slug: string) => `store:${slug}`;
export const TEMPLATE_TAG = "template-store";

type Row = Record<string, unknown>;

const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** A store and its active markets, by slug, or null. */
export async function getStore(slug: string): Promise<Store | null> {
  return isStoreSlug(slug) ? loadStore(slug) : null;
}

async function loadStore(slug: string): Promise<Store | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(storeTag(slug));

  const [row] = await db().execute<Row>(sql`
    select
      s.id, s.slug, s.name, s.status, s.is_template, s.setup_completed_at,
      s.legal_name, s.organisation_number, s.contact_email, s.postal_address, s.country,
      coalesce(
        json_agg(json_build_object(
          'code', m.code, 'currency', m.currency, 'defaultLocale', m.default_locale
        ) order by (m.code = s.country) desc nulls last, m.created_at, m.code)
          filter (where m.code is not null),
        '[]'
      ) as markets
    from commerce.stores s
    left join commerce.markets m on m.store_id = s.id and m.active
    where s.slug = ${slug}
    group by s.id
  `);
  if (!row) return null;

  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    status: row.status as StoreStatus,
    isTemplate: Boolean(row.is_template),
    setupCompletedAt: row.setup_completed_at
      ? new Date(String(row.setup_completed_at)).toISOString()
      : null,
    details: {
      legalName: text(row.legal_name),
      organisationNumber: text(row.organisation_number),
      contactEmail: text(row.contact_email),
      postalAddress: text(row.postal_address),
      country: text(row.country),
    },
    markets: (row.markets as { code: string; currency: string; defaultLocale: string }[]).map(
      toMarket,
    ),
  };
}

/** A store whose storefront is open to shoppers, or null. */
export async function getOpenStore(slug: string): Promise<Store | null> {
  const store = await getStore(slug);
  return store?.status === "active" ? store : null;
}

/** The template store's slug: the demo shown to visitors, prerendered at build. */
export async function templateStoreSlug(): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(TEMPLATE_TAG);
  const [row] = await db().execute<Row>(sql`
    select slug from commerce.stores where is_template
  `);
  return row ? String(row.slug) : null;
}

/** Every country the platform can sell to, by English name. */
export async function listCountries(): Promise<Country[]> {
  "use cache";
  cacheLife("days");
  const rows = await db().execute<Row>(sql`
    select code, name, currency, in_eu from commerce.countries order by name
  `);
  return rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    currency: String(row.currency),
    inEu: Boolean(row.in_eu),
  }));
}
