import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { toMarket, type Market } from "@/lib/markets";
import { isStoreSlug } from "@/lib/paths";
import { parseTracking, type TrackingSettings } from "@/lib/cookie-consent";
import { parseCustomCode, type CustomCode } from "@/lib/custom-code";
import type { SiteFonts } from "@/lib/fonts";
import { parseNavigation, type StoreNavigation } from "@/lib/navigation";
import { parseStoreSeo, type StoreSeo } from "@/lib/seo";
import { parseStoreTheme, type StoreTheme } from "@/lib/theme";

export type StoreStatus = "active" | "suspended" | "closed";

export type Store = {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
  isTemplate: boolean;
  setupCompletedAt: string | null;
  /** Stripe is switched on with keys for its mode, so shoppers can pay. */
  paymentsOn: boolean;
  /** Payments are in test mode: shoppers pay with Stripe's test cards, no real money. */
  paymentsTest: boolean;
  /** The business behind the store, shown to shoppers. */
  details: StoreDetails;
  /** Active markets, the store's own country first. */
  markets: Market[];
  /** Search and sharing settings. */
  seo: StoreSeo;
  /** Logo and menus for the storefront's header and footer (D30). */
  navigation: StoreNavigation;
  /** The store's own page shown as its front page (D54), or null for the product list. */
  frontPageId: string | null;
  /** Analytics and marketing tools, loaded only with the shopper's consent (D58). */
  tracking: TrackingSettings;
  /** The owner's own code for the head and body (D61), as saved; `liveCustomCode()` says whether it is added. */
  customCode: CustomCode;
  /** The storefront's design (D60): colours, fonts and the rest, from a template. */
  theme: StoreTheme;
  /** The theme's heading and body fonts (D59), self-hosted. */
  fonts: SiteFonts;
};

export type StoreDetails = {
  legalName: string | null;
  organisationNumber: string | null;
  contactEmail: string | null;
  postalAddress: string | null;
  country: string | null;
};

export type Country = { code: string; name: string; currency: string; inEu: boolean };

/** Revalidate after changing a store's name, status, markets or payment switch. */
export const storeTag = (slug: string) => `store:${slug}`;
export const TEMPLATE_TAG = "template-store";

import { platformModes } from "./stripe";

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

  const [row] = await readDb().execute<Row>(sql`
    select
      s.id, s.slug, s.name, s.status, s.is_template, s.setup_completed_at,
      s.legal_name, s.organisation_number, s.contact_email, s.postal_address, s.country, s.seo, s.navigation, s.front_page_id, s.tracking, s.custom_code, s.theme,
      exists (
        select 1 from commerce.payment_providers p
        where p.store_id = s.id and p.enabled
          and (p.active_mode = 'test' or exists (
            select 1 from commerce.stripe_accounts a
            where a.store_id = p.store_id and a.mode = p.active_mode and a.card_payments = 'active'
          ))
      ) as payments_on,
      exists (
        select 1 from commerce.payment_providers p
        where p.store_id = s.id and p.enabled and p.active_mode = 'test'
      ) as payments_test,
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
    // Test payments also need Kaizen's own test keys to be set.
    paymentsOn: Boolean(row.payments_on) && (!row.payments_test || platformModes().includes("test")),
    paymentsTest: Boolean(row.payments_test),
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
    seo: parseStoreSeo(row.seo),
    navigation: parseNavigation(row.navigation),
    frontPageId: text(row.front_page_id),
    tracking: parseTracking(row.tracking),
    customCode: parseCustomCode(row.custom_code),
    ...themed(row.theme),
  };
}

function themed(value: unknown): Pick<Store, "theme" | "fonts"> {
  const theme = parseStoreTheme(value);
  return { theme, fonts: theme.settings.fonts };
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
  const [row] = await readDb().execute<Row>(sql`
    select slug from commerce.stores where is_template
  `);
  return row ? String(row.slug) : null;
}

/** Every country the platform can sell to, by English name. */
export async function listCountries(): Promise<Country[]> {
  "use cache";
  cacheLife("days");
  const rows = await readDb().execute<Row>(sql`
    select code, name, currency, in_eu from commerce.countries order by name
  `);
  return rows.map((row) => ({
    code: String(row.code),
    name: String(row.name),
    currency: String(row.currency),
    inEu: Boolean(row.in_eu),
  }));
}
