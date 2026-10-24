import type { Metadata } from "next";

import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { CookieScanPanel } from "@/components/admin/cookie-scan";
import { ConsentLog, CustomCodeForm, TrackingForm } from "@/components/admin/cookie-settings";
import { reviewFindings } from "@/lib/cookie-scan";
import { marketPath, storeDomain, storeHref } from "@/lib/paths";
import { memberCan, requirePermission } from "@/server/permissions";
import { listConsents } from "@/server/consents";
import { latestFindings, listScans } from "@/server/cookie-scans";
import { listCookieNotes } from "@/server/site-cookies";
import { Card, PageHeader } from "@/components/admin/ui";

import { requestStoreScanAction, saveStoreCookieNoteAction, saveStoreCustomCodeAction, saveStoreTrackingAction } from "./actions";

export const metadata: Metadata = { title: "Cookies and tracking" };

/** The store's cookies, tools and consents (D58). */
export default async function StoreCookiesPage({ params }: PageProps<"/admin/[store]/settings/cookies">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const market = store.markets[0];
  const lang = adminLangOf(current.account.adminLocale);
  const words = adminText(lang, "legal");
  const w = words.cookies;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const [consents, scans, lastDone, notes] = await Promise.all([
    listConsents(store.id),
    listScans(store.id),
    latestFindings(store.id),
    listCookieNotes(store.id),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />
      <Card title={store.visitCounting ? w.visitsOn : w.visitsOff} className="flex flex-col gap-1" compact>
        <p className="max-w-2xl text-sm text-muted">
          {store.visitCounting ? w.visitsOnText : w.visitsOffText}
        </p>
      </Card>
      <TrackingForm
        tracking={store.tracking}
        action={saveStoreTrackingAction.bind(null, store.slug)}
        cookiePage={market ? storeHref(store.slug, marketPath(store.slug, market.slug, "/cookies")) : "/"}
        words={words}
        ads
      />
      <CustomCodeForm
        code={store.customCode}
        live={storeDomain() !== null}
        action={saveStoreCustomCodeAction.bind(null, store.slug)}
        words={words}
      />
      <CookieScanPanel
        scans={scans}
        lastDone={lastDone}
        findings={lastDone ? reviewFindings(lastDone.items, notes) : []}
        scanAction={requestStoreScanAction.bind(null, store.slug)}
        noteAction={memberCan(current, "owner") ? saveStoreCookieNoteAction.bind(null, store.slug) : null}
        words={words}
        locale={locale}
        purposeLang={lang}
      />
      <ConsentLog consents={consents} words={words} locale={locale} />
    </div>
  );
}
