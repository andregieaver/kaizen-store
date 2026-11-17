import type { Metadata } from "next";

import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { countWords, fillWords } from "@/lib/admin-fill";
import { toolCategories } from "@/lib/cookie-consent";

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
  // Round 30 (D703): on a phone what visitors see now comes first, then each part a row with its state.
  const p = w.phone;
  const row = { change: p.change, done: p.done, flat: true } as const;
  const look = { change: p.open, done: p.close, flat: true } as const;
  const asked = toolCategories(store.tracking);
  const toolsOn = Object.values(store.tracking ?? {}).filter((v) => typeof v === "string" && v.trim() !== "").length;
  const codeOn = Object.values(store.customCode ?? {}).filter((snippet) => snippet && snippet.code.trim() !== "").length;
  return (
    <div className="flex flex-col gap-6 max-sm:gap-4">
      <PageHeader
        title={w.title}
        description={<span className="max-sm:hidden">{w.description}</span>}
      />
      <section aria-label={p.nowTitle} className="flex flex-col gap-1.5 rounded-panel bg-card p-4 sm:hidden">
        <span className="text-caption text-ink-2">{p.nowTitle}</span>
        <span className="text-body-strong text-ink">{asked.length === 0 ? p.noBanner : p.banner}</span>
        <span className="text-sm text-ink-2">{asked.length === 0 ? p.noBannerText : p.bannerText}</span>
        {market && (
          <a href={storeHref(store.slug, marketPath(store.slug, market.slug, "/cookies"))} className="text-sm underline">
            {p.cookiePage}
          </a>
        )}
      </section>
      <PhoneRows>
      <PhoneRow title={p.visits} sub={store.visitCounting ? p.on : p.visitsOff} {...row}>
      <Card title={store.visitCounting ? w.visitsOn : w.visitsOff} className="flex flex-col gap-1" compact>
        <p className="max-w-2xl text-sm text-muted">
          {store.visitCounting ? w.visitsOnText : w.visitsOffText}
        </p>
      </Card>
      </PhoneRow>
      <PhoneRow title={p.tools} sub={toolsOn > 0 ? countWords(toolsOn, p.toolsOn, { n: String(toolsOn) }) : p.noneOn} {...row}>
      <TrackingForm
        tracking={store.tracking}
        action={saveStoreTrackingAction.bind(null, store.slug)}
        cookiePage={market ? storeHref(store.slug, marketPath(store.slug, market.slug, "/cookies")) : "/"}
        words={words}
        ads
      />
      </PhoneRow>
      <PhoneRow title={p.code} sub={codeOn > 0 ? countWords(codeOn, p.codeOn, { n: String(codeOn) }) : storeDomain() !== null ? p.none : p.codeLater} {...row}>
      <CustomCodeForm
        code={store.customCode}
        live={storeDomain() !== null}
        action={saveStoreCustomCodeAction.bind(null, store.slug)}
        words={words}
      />
      </PhoneRow>
      <PhoneRow title={p.scan} sub={lastDone?.finishedAt ? fillWords(p.scannedOn, { day: new Date(lastDone.finishedAt).toLocaleDateString(locale, { dateStyle: "medium" }) }) : p.notScanned} {...look}>
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
      </PhoneRow>
      <PhoneRow title={p.consents} sub={consents.length > 0 ? countWords(consents.length, p.consentsN, { n: String(consents.length) }) : p.noConsents} {...look}>
        <ConsentLog consents={consents} words={words} locale={locale} />
      </PhoneRow>
      </PhoneRows>
    </div>
  );
}
