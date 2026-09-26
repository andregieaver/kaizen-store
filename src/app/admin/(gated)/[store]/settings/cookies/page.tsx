import type { Metadata } from "next";

import { CookieScanPanel } from "@/components/admin/cookie-scan";
import { ConsentLog, CustomCodeForm, TrackingForm } from "@/components/admin/cookie-settings";
import { reviewFindings } from "@/lib/cookie-scan";
import { marketPath, storeDomain, storeHref } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { listConsents } from "@/server/consents";
import { latestFindings, listScans } from "@/server/cookie-scans";
import { listCookieNotes } from "@/server/site-cookies";

import { requestStoreScanAction, saveStoreCookieNoteAction, saveStoreCustomCodeAction, saveStoreTrackingAction } from "./actions";

export const metadata: Metadata = { title: "Cookies and tracking" };

/** The store's cookies, tools and consents (D58). */
export default async function StoreCookiesPage({ params }: PageProps<"/admin/[store]/settings/cookies">) {
  const { store, role } = await requireMember((await params).store);
  const market = store.markets[0];
  const [consents, scans, lastDone, notes] = await Promise.all([
    listConsents(store.id),
    listScans(store.id),
    latestFindings(store.id),
    listCookieNotes(store.id),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Cookies and tracking</h1>
        <p className="max-w-2xl text-sm text-muted">
          What your store stores in shoppers&apos; browsers, the tools and code you use to measure and market, and the
          choices shoppers make about them. Your cookie page lists every cookie, in each of your languages.
        </p>
      </div>
      <TrackingForm
        tracking={store.tracking}
        action={saveStoreTrackingAction.bind(null, store.slug)}
        cookiePage={market ? storeHref(store.slug, marketPath(store.slug, market.slug, "/cookies")) : "/"}
      />
      <CustomCodeForm
        code={store.customCode}
        live={storeDomain() !== null}
        action={saveStoreCustomCodeAction.bind(null, store.slug)}
      />
      <CookieScanPanel
        scans={scans}
        lastDone={lastDone}
        findings={lastDone ? reviewFindings(lastDone.items, notes) : []}
        scanAction={requestStoreScanAction.bind(null, store.slug)}
        noteAction={role === "owner" ? saveStoreCookieNoteAction.bind(null, store.slug) : null}
      />
      <ConsentLog consents={consents} />
    </div>
  );
}
