import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { readDb } from "@/db/client";
import { parseStoreAudience, type StoreAudience } from "@/lib/b2b";
import type { StoreCurrency } from "@/lib/currency";
import { localizationOf, type Localization } from "@/lib/localization";
import { toMarket, type Market } from "@/lib/markets";
import { isTermsMode, type TermsMode } from "@/lib/checkout-terms";
import { isLegalRole, type LegalRole } from "@/lib/legal-roles";
import { isPageRole, type PageRole } from "@/lib/page-roles";
import { isStoreSlug } from "@/lib/paths";
import { parseTracking, type TrackingSettings } from "@/lib/cookie-consent";
import { parseCustomCode, type CustomCode } from "@/lib/custom-code";
import type { SiteFonts } from "@/lib/fonts";
import { parseMenuItems, parseNavigation, type Menu, type StoreNavigation } from "@/lib/navigation";
import { parseStoreSeo, type StoreSeo } from "@/lib/seo";
import { returnPolicyOf, type ReturnPolicyFacts } from "@/lib/structured-data";
import { featureOn, normaliseFeatures, type FeatureId } from "@/lib/store-features";
import { parseStoreTheme, type StoreTheme } from "@/lib/theme";

export type StoreStatus = "active" | "suspended" | "closed";

export type Store = {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
  /** When the store was closed, as an ISO date (D171); null while it is not closed. */
  closedAt: string | null;
  isTemplate: boolean;
  /** A store template (D175, docs/store-templates.md): a preview that takes no orders and is never indexed. */
  starter: boolean;
  setupCompletedAt: string | null;
  /** Stripe is switched on with keys for its mode, so shoppers can pay. */
  paymentsOn: boolean;
  /** Payments are in test mode: shoppers pay with Stripe's test cards, no real money. */
  paymentsTest: boolean;
  /** The business behind the store, shown to shoppers. */
  details: StoreDetails;
  /** Who the store sells to (B2B): consumers, businesses or both. */
  audience: StoreAudience;
  /** Selling to both: ask first-time visitors whether they buy privately or for a business. */
  businessPopup: boolean;
  /** On phones, open the slide-out cart once something is added to it (D64). */
  openCartOnAdd: boolean;
  /** The store's return rules as search engines are told them (D153): the window, who pays return shipping, excluded goods. */
  returnPolicy: ReturnPolicyFacts;
  /** Cookieless visit counting for the analytics is on (D152); off until the owner switches it on. */
  visitCounting: boolean;
  /**
   * The features the owner keeps switched on (D178, `src/lib/store-features.ts`): read what is *on* with `featureOn(store, id)`, which also asks
   * for what the feature needs (the shop above all).
   */
  features: FeatureId[];
  /** Appointments or stays and rentals are on (D65, D178: the feature `appointments` or `bookings`, with the shop). */
  bookingsOn: boolean;
  /** Subscription boxes are on (D102, D178: the feature `boxes`, with the shop). */
  deliveriesOn: boolean;
  /** Work: clients, assignments, time and invoices for consultants (D122). */
  workOn: boolean;
  /** Where the store's times are, e.g. appointments' (D65). */
  timeZone: string;
  /** Hours before an appointment its reminder goes (D65); 0 sends none. */
  bookingReminderHours: number;
  /** Active markets, the store's own country first, each as its country is shown by default. */
  markets: Market[];
  /**
   * The languages and currencies it offers, whatever its countries (D109):
   * the languages (main first) products, pages and emails are written in, and
   * the currencies shoppers can choose with the rates they are converted at.
   */
  localization: Localization;
  /** The rates are kept up to date from the ECB's, and when they last were. */
  ratesAuto: boolean;
  ratesUpdatedAt: string | null;
  /** What the owner chose (the store's own, before the countries' are added): the settings page edits these. */
  chosenLocales: string[];
  chosenCurrencies: StoreCurrency[];
  /** Search and sharing settings. */
  seo: StoreSeo;
  /** Logo and menus for the storefront's header and footer (D30). */
  navigation: StoreNavigation;
  /** The store's menus (D85), and those its standard header (and phone menu) and footer show. */
  menus: Menu[];
  headerMenuId: string | null;
  footerMenuId: string | null;
  /** The store's own page shown as its front page (D54), or null for the product list. */
  frontPageId: string | null;
  /** The page shown as its All products page at /products (D83), or null for the standard list. */
  productsPageId: string | null;
  /** The pages chosen for the blog, the search page and the 404 page (D112), by role. */
  pageRoles: Partial<Record<PageRole, string>>;
  /** The pages chosen for the terms, privacy statement and the like (wave 1, 1e): linked roles, served at their own address. */
  legalPages: Partial<Record<LegalRole, string>>;
  /** What checkout says about the terms: a sentence with links, with a tick box, or nothing (wave 1, 1e). */
  termsAtCheckout: TermsMode;
  /** Analytics and marketing tools, loaded only with the shopper's consent (D58). */
  tracking: TrackingSettings;
  /** The owner's own code for the head and body (D61), as saved; `liveCustomCode()` says whether it is added. */
  customCode: CustomCode;
  /** The owner's own CSS for every page of the storefront (D100), checked when saved. */
  customCss: string;
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
      s.id, s.slug, s.name, s.status, s.closed_at, s.is_template, s.starter, s.setup_completed_at,
      s.legal_name, s.organisation_number, s.contact_email, s.postal_address, s.country, s.seo, s.navigation, s.header_menu_id, s.footer_menu_id, s.front_page_id, s.products_page_id, s.tracking, s.custom_code, s.custom_css, s.theme,
      s.terms_at_checkout, s.audience, s.business_popup, s.open_cart_on_add, s.visit_counting, s.modules, s.features, s.time_zone, s.booking_reminder_hours,
      s.locales, s.rates_auto, s.rates_updated_at,
      (
        select coalesce(json_agg(json_build_object('currency', c.currency, 'rate', c.rate, 'roundTo', c.round_to) order by c.position, c.currency), '[]')
        from commerce.store_currencies c where c.store_id = s.id
      ) as currencies,
      (select coalesce(jsonb_object_agg(r.role, r.page_id), '{}'::jsonb) from commerce.page_roles r where r.store_id = s.id) as page_roles,
      (
        select json_build_object('windowDays', rs.window_days, 'whoPaysReturn', rs.who_pays_return, 'acceptExcluded', rs.accept_excluded)
        from commerce.return_settings rs where rs.store_id = s.id
      ) as return_policy,
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
      ) as markets,
      (
        select coalesce(json_agg(json_build_object('id', mn.id, 'name', mn.name, 'items', mn.items) order by mn.name), '[]')
        from commerce.menus mn where mn.store_id = s.id
      ) as menus
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
    closedAt: row.closed_at ? new Date(String(row.closed_at)).toISOString() : null,
    isTemplate: Boolean(row.is_template),
    starter: Boolean(row.starter),
    setupCompletedAt: row.setup_completed_at
      ? new Date(String(row.setup_completed_at)).toISOString()
      : null,
    // Test payments also need Kaizen's own test keys to be set.
    // A store template (D175) takes no payment whatever its switches say.
    paymentsOn: !row.starter && Boolean(row.payments_on) && (!row.payments_test || platformModes().includes("test")),
    paymentsTest: Boolean(row.payments_test),
    details: {
      legalName: text(row.legal_name),
      organisationNumber: text(row.organisation_number),
      contactEmail: text(row.contact_email),
      postalAddress: text(row.postal_address),
      country: text(row.country),
    },
    audience: parseStoreAudience(row.audience),
    businessPopup: Boolean(row.business_popup) && row.audience === "both",
    openCartOnAdd: Boolean(row.open_cart_on_add),
    returnPolicy: returnPolicyOf(row.return_policy),
    visitCounting: Boolean(row.visit_counting),
    ...featured(row.features),
    workOn: ((row.modules ?? []) as string[]).includes("work"),
    timeZone: String(row.time_zone ?? "Europe/Oslo"),
    bookingReminderHours: Number(row.booking_reminder_hours ?? 24),
    ...localized(row),
    seo: parseStoreSeo(row.seo),
    navigation: parseNavigation(row.navigation),
    menus: (row.menus as { id: string; name: string; items: unknown }[]).map((m) => ({ id: m.id, name: m.name, items: parseMenuItems(m.items) })),
    headerMenuId: text(row.header_menu_id),
    footerMenuId: text(row.footer_menu_id),
    frontPageId: text(row.front_page_id),
    productsPageId: text(row.products_page_id),
    pageRoles: Object.fromEntries(Object.entries((row.page_roles ?? {}) as Record<string, string>).filter(([role]) => isPageRole(role))),
    legalPages: Object.fromEntries(Object.entries((row.page_roles ?? {}) as Record<string, string>).filter(([role]) => isLegalRole(role))),
    termsAtCheckout: isTermsMode(row.terms_at_checkout) ? row.terms_at_checkout : "link",
    tracking: parseTracking(row.tracking),
    customCode: parseCustomCode(row.custom_code),
    customCss: String(row.custom_css ?? ""),
    ...themed(row.theme),
  };
}

/** The markets and what the store offers in languages and currencies, as read from its row. */
function localized(row: Row): Pick<Store, "markets" | "localization" | "ratesAuto" | "ratesUpdatedAt" | "chosenLocales" | "chosenCurrencies"> {
  const markets = (row.markets as { code: string; currency: string; defaultLocale: string }[]).map(toMarket);
  const chosenLocales = ((row.locales ?? []) as string[]).map(String);
  const chosenCurrencies = ((row.currencies ?? []) as { currency: string; rate: string | number | null; roundTo: number }[]).map((c) => ({
    currency: String(c.currency).trim(),
    rate: c.rate === null ? null : Number(c.rate),
    roundTo: Number(c.roundTo),
  }));
  return {
    markets,
    localization: localizationOf(chosenLocales, chosenCurrencies, markets),
    ratesAuto: Boolean(row.rates_auto),
    ratesUpdatedAt: row.rates_updated_at ? new Date(String(row.rates_updated_at)).toISOString() : null,
    chosenLocales,
    chosenCurrencies,
  };
}

function featured(value: unknown): Pick<Store, "features" | "bookingsOn" | "deliveriesOn"> {
  const features = normaliseFeatures(Array.isArray(value) ? value.map(String) : []);
  return {
    features,
    bookingsOn: featureOn(features, "appointments") || featureOn(features, "bookings"),
    deliveriesOn: featureOn(features, "boxes"),
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
