import type { Metadata } from "next";
import { connection } from "next/server";

import { CookieScanPanel } from "@/components/admin/cookie-scan";
import { ConsentLog, TrackingForm } from "@/components/admin/cookie-settings";
import { reviewFindings } from "@/lib/cookie-scan";
import { requirePlatformAdmin } from "@/server/auth";
import { listConsents } from "@/server/consents";
import { latestFindings, listScans } from "@/server/cookie-scans";
import { getPlatformChrome } from "@/server/platform-navigation";
import { listCookieNotes } from "@/server/site-cookies";
import { PageHeader } from "@/components/admin/ui";

import { requestPlatformScanAction, savePlatformCookieNoteAction, savePlatformTrackingAction } from "./actions";

export const metadata: Metadata = { title: "Cookies and tracking" };

/** Kaizen's own cookies, tools and consents (D58). */
export default async function PlatformCookiesPage() {
  await connection();
  await requirePlatformAdmin();
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
        title="Cookies and tracking"
        description={<>What Kaizena Flow&apos;s own site stores in visitors&apos; browsers, the tools it uses to measure and market, and the choices visitors make. Each store sets its own under Cookies and tracking in its admin.</>}
      />
      <TrackingForm tracking={chrome.tracking} action={savePlatformTrackingAction} cookiePage="/cookies" />
      <CookieScanPanel
        scans={scans}
        lastDone={lastDone}
        findings={lastDone ? reviewFindings(lastDone.items, notes) : []}
        scanAction={requestPlatformScanAction}
        noteAction={savePlatformCookieNoteAction}
      />
      <ConsentLog consents={consents} />
    </>
  );
}
