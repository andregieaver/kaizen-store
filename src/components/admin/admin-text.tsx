"use client";

import { useContext, useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { ADMIN_LANG_FACTS, ADMIN_LANG_KEY, ADMIN_LANGS, type AdminLang } from "@/lib/admin-lang";
import { commonEn } from "@/lib/admin-messages/common.en";
import { domainsEn } from "@/lib/admin-messages/domains.en";
import { homeEn } from "@/lib/admin-messages/home.en";
import { customersEn } from "@/lib/admin-messages/customers.en";
import { privacyEn } from "@/lib/admin-messages/privacy.en";
import { marketingEn } from "@/lib/admin-messages/marketing.en";
import { discountsEn } from "@/lib/admin-messages/discounts.en";
import { loyaltyEn } from "@/lib/admin-messages/loyalty.en";
import { platformEn } from "@/lib/admin-messages/platform.en";
import { platformSiteEn } from "@/lib/admin-messages/platform-site.en";
import { platformToolsEn } from "@/lib/admin-messages/platform-tools.en";
import { bookingsEn } from "@/lib/admin-messages/bookings.en";
import { supportEn } from "@/lib/admin-messages/support.en";
import { workEn } from "@/lib/admin-messages/work.en";
import { assistantEn } from "@/lib/admin-messages/assistant.en";
import { staffEmailsEn } from "@/lib/admin-messages/staff-emails.en";
import { analyticsEn } from "@/lib/admin-messages/analytics.en";
import { financeEn } from "@/lib/admin-messages/finance.en";
import { taxReportsEn } from "@/lib/admin-messages/tax-reports.en";
import { reportsEn } from "@/lib/admin-messages/reports.en";
import { customReportsEn } from "@/lib/admin-messages/custom-reports.en";
import { settingsEn } from "@/lib/admin-messages/settings.en";
import { taxEn } from "@/lib/admin-messages/tax.en";
import { paymentsEn } from "@/lib/admin-messages/payments.en";
import { shippingEn } from "@/lib/admin-messages/shipping.en";
import { notificationsEn } from "@/lib/admin-messages/notifications.en";
import { legalEn } from "@/lib/admin-messages/legal.en";
import { staffEn } from "@/lib/admin-messages/staff.en";
import { billingEn } from "@/lib/admin-messages/billing.en";
import { builderEn } from "@/lib/admin-messages/builder.en";
import { blocksEn } from "@/lib/admin-messages/blocks.en";
import { websiteEn } from "@/lib/admin-messages/website.en";
import { designEn } from "@/lib/admin-messages/design.en";
import { redirectsEn } from "@/lib/admin-messages/redirects.en";
import { experimentsEn } from "@/lib/admin-messages/experiments.en";

import { productsEn } from "@/lib/admin-messages/products.en";
import { productEn } from "@/lib/admin-messages/product.en";
import { inventoryEn } from "@/lib/admin-messages/inventory.en";
import { giftCardsEn } from "@/lib/admin-messages/gift-cards.en";
import { reviewsEn } from "@/lib/admin-messages/reviews.en";
import { fieldsEn } from "@/lib/admin-messages/fields.en";

import { ordersEn } from "@/lib/admin-messages/orders.en";
import { orderEn } from "@/lib/admin-messages/order.en";
import { draftsEn } from "@/lib/admin-messages/drafts.en";
import { returnsEn } from "@/lib/admin-messages/returns.en";
import { invoicesEn } from "@/lib/admin-messages/invoices.en";

import { platformLegalEn } from "@/lib/admin-messages/platform-legal.en";
import { setupEn } from "@/lib/admin-messages/setup.en";
import { shellEn } from "@/lib/admin-messages/shell.en";
import { capacityEn } from "@/lib/admin-messages/capacity.en";
import { signInEn } from "@/lib/admin-messages/sign-in.en";
import { contentEn } from "@/lib/admin-messages/content.en";
import { blogEn } from "@/lib/admin-messages/blog.en";
import { schedulesEn } from "@/lib/admin-messages/schedules.en";
import type { AdminArea, AdminAreaMessages } from "@/lib/admin-text";

import { AdminTextContext } from "./admin-text-context";

/**
 * The admin's words in the browser (D312 A0, `docs/platform-admin-i18n.md` 3.3): the signed-in layout hands its client parts the account's
 * language and the slices of the catalogue they read (`adminTexts()`), and a part asks `useAdminText(area)`. An area not handed down is
 * read in English, so a part converted before its layout still draws.
 */


const ENGLISH: AdminAreaMessages = { common: commonEn, domains: domainsEn, home: homeEn, customers: customersEn, privacy: privacyEn, marketing: marketingEn, discounts: discountsEn, loyalty: loyaltyEn, platform: platformEn, platformSite: platformSiteEn, platformTools: platformToolsEn, bookings: bookingsEn, support: supportEn, work: workEn, assistant: assistantEn, staffEmails: staffEmailsEn, analytics: analyticsEn, finance: financeEn, taxReports: taxReportsEn, reports: reportsEn, customReports: customReportsEn, settings: settingsEn, tax: taxEn, payments: paymentsEn, shipping: shippingEn, notifications: notificationsEn, legal: legalEn, staff: staffEn, billing: billingEn, capacity: capacityEn, builder: builderEn, blocks: blocksEn, website: websiteEn, design: designEn, redirects: redirectsEn, experiments: experimentsEn, products: productsEn, product: productEn, inventory: inventoryEn, giftCards: giftCardsEn, reviews: reviewsEn, fields: fieldsEn, content: contentEn, orders: ordersEn, order: orderEn, drafts: draftsEn, returns: returnsEn, invoices: invoicesEn, platformLegal: platformLegalEn, setup: setupEn, shell: shellEn, signIn: signInEn, blog: blogEn, schedules: schedulesEn };


export { AdminTextProvider } from "./admin-text-context";

/**
 * More areas for the client parts under it (D312 A4): a page hands down the slices its own parts read (`adminTexts(lang, ["orders"])`),
 * kept beside the layout's, so the layout's provider stays small.
 */
export function AdminTextScope({ texts, children }: { texts: Partial<AdminAreaMessages>; children: ReactNode }) {
  const parent = useContext(AdminTextContext);
  return <AdminTextContext.Provider value={{ lang: parent.lang, texts: { ...parent.texts, ...texts } }}>{children}</AdminTextContext.Provider>;
}

/** An area's words in the account's language. */
export function useAdminText<A extends AdminArea>(area: A): AdminAreaMessages[A] {
  const { texts } = useContext(AdminTextContext);
  return (texts[area] as AdminAreaMessages[A] | undefined) ?? ENGLISH[area];
}

/** The account's language for the admin. */
export function useAdminLang(): AdminLang {
  return useContext(AdminTextContext).lang;
}

/** Keeps the browser's copy of the account's language (for `<html lang>` before paint, `adminLangScript()`) in step with the account. */
export function AdminLangSync({ lang }: { lang: AdminLang }) {
  useEffect(() => {
    document.documentElement.lang = ADMIN_LANG_FACTS[lang].tag;
    try {
      if (localStorage.getItem(ADMIN_LANG_KEY) !== lang) localStorage.setItem(ADMIN_LANG_KEY, lang);
    } catch {
      // Storage refused (a private window): the page's own `lang` is set above.
    }
  }, [lang]);
  return null;
}

export type SaveAdminLang = (lang: AdminLang) => Promise<void>;

/** Saves a language and draws the admin again in it: its words are the server's. */
function useChoose(save: SaveAdminLang) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const choose = (lang: AdminLang) =>
    start(async () => {
      try {
        localStorage.setItem(ADMIN_LANG_KEY, lang);
      } catch {}
      document.documentElement.lang = ADMIN_LANG_FACTS[lang].tag;
      await save(lang);
      router.refresh();
    });
  return { pending, choose };
}

/** Your account's choice of the admin's language: each language by its own name, whatever the admin is in now. */
export function AdminLanguageField({ save }: { save: SaveAdminLang }) {
  const lang = useAdminLang();
  const w = useAdminText("common").language;
  const { pending, choose } = useChoose(save);
  // The account's language; while a choice saves and the admin is drawn again, the radio holds what was pressed.
  const [picked, setPicked] = useState(lang);
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="sr-only">{w.title}</legend>
      <div className="flex flex-wrap gap-2">
        {ADMIN_LANGS.map((option) => (
          <label
            key={option}
            lang={ADMIN_LANG_FACTS[option].tag}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-line px-3 text-sm has-checked:border-brand has-checked:font-medium"
          >
            <input
              type="radio"
              name="admin-language"
              value={option}
              checked={picked === option}
              disabled={pending}
              onChange={() => {
                setPicked(option);
                choose(option);
              }}
            />
            {ADMIN_LANG_FACTS[option].name}
          </label>
        ))}
      </div>
      <p className="text-xs text-muted" aria-live="polite">
        {pending ? w.saving : w.kept}
      </p>
    </fieldset>
  );
}

/** The account menu's language switch: each other language by its own name, a press away. */
export function AdminLanguageSwitch({ save }: { save: SaveAdminLang }) {
  const lang = useAdminLang();
  const { pending, choose } = useChoose(save);
  return (
    <span className="flex items-center gap-1">
      {ADMIN_LANGS.map((option) => (
        <button
          key={option}
          type="button"
          lang={ADMIN_LANG_FACTS[option].tag}
          aria-pressed={option === lang}
          disabled={pending || option === lang}
          onClick={() => choose(option)}
          className="rounded-md px-2 py-1 text-sm text-muted hover:bg-sunken hover:text-ink aria-pressed:font-medium aria-pressed:text-ink"
        >
          {ADMIN_LANG_FACTS[option].name}
        </button>
      ))}
    </span>
  );
}
