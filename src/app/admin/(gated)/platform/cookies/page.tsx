import type { Metadata } from "next";
import { connection } from "next/server";

import { CookieScanPanel } from "@/components/admin/cookie-scan";
import { ConsentLog, TrackingForm } from "@/components/admin/cookie-settings";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { reviewFindings } from "@/lib/cookie-scan";
import { requirePlatformAdmin } from "@/server/auth";
import { listConsents } from "@/server/consents";
import { latestFindings, listScans } from "@/server/cookie-scans";
import { getPlatformChrome } from "@/server/platform-navigation";
import { listCookieNotes } from "@/server/site-cookies";
import { PageHeader } from "@/components/admin/ui";

import { requestPlatformScanAction, savePlatformCookieNoteAction, savePlatformTrackingAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";

export const metadata: Metadata = { title: "Cookies and tracking" };

/** Kaizen's own cookies, tools and consents (D58). */
export default async function PlatformCookiesPage() {
  await connection();
  await requirePlatformAdmin();
  const { w, lang } = await platformSiteWords();
  const words = adminText(lang, "legal");
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const [chrome, consents, scans, lastDone, notes] = await Promise.all([
    getPlatformChrome(),
    listConsents(null),
    listScans(null),
    latestFindings(null),
    listCookieNotes(null),
  ]);
  return (
    <>
      <PageHeader
        title={w.misc.cookies.title}
        description={w.misc.cookies.description}
      />
      <TrackingForm tracking={chrome.tracking} action={savePlatformTrackingAction} cookiePage="/cookies" words={words} />
      <CookieScanPanel
        scans={scans}
        lastDone={lastDone}
        findings={lastDone ? reviewFindings(lastDone.items, notes) : []}
        scanAction={requestPlatformScanAction}
        noteAction={savePlatformCookieNoteAction}
        words={words}
        locale={locale}
        purposeLang={lang}
      />
      <ConsentLog consents={consents} words={words} locale={locale} />
    </>
  );
}
