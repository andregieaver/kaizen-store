import type { Metadata } from "next";

import { CookieScanPanel } from "@/components/admin/cookie-scan";
import { ConsentLog, CustomCodeForm, TrackingForm } from "@/components/admin/cookie-settings";
import { reviewFindings } from "@/lib/cookie-scan";
import { marketPath, storeDomain, storeHref } from "@/lib/paths";
import { memberCan, requirePermission } from "@/server/permissions";
import { listConsents } from "@/server/consents";
import { latestFindings, listScans } from "@/server/cookie-scans";
import { listCookieNotes } from "@/server/site-cookies";

import { requestStoreScanAction, saveStoreCookieNoteAction, saveStoreCustomCodeAction, saveStoreTrackingAction } from "./actions";

export const metadata: Metadata = { title: "Cookies and tracking" };

/** The store's cookies, tools and consents (D58). */
export default async function StoreCookiesPage({ params }: PageProps<"/admin/[store]/settings/cookies">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
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
      <section aria-labelledby="visit-counting-heading" className="flex flex-col gap-1 rounded-lg border border-border bg-background p-5">
        <h2 id="visit-counting-heading" className="font-medium">
          Visit counting for your analytics: {store.visitCounting ? "on" : "off"}
        </h2>
        <p className="max-w-2xl text-sm text-muted">
          {store.visitCounting
            ? "Your store counts visits without cookies, and nothing is set or stored in the shopper's browser, so it shows no cookie banner. A visit is one line with the country, the kind of device, the channel, the first page and how many pages were seen, under an id made with a key that changes every day, so it cannot be followed from one day to the next. No IP address or browser details are kept, and visitors who send Global Privacy Control or Do Not Track are not counted. When a shopper adds something to the cart that day, that visit is tied to the cart (and so to the order made from it), which is how a sale gets its channel. Your cookie page says all this, in each of your languages."
            : "Visit counting is off. When you switch it on under Analytics settings, your store counts visits without cookies (one line per visitor per day under an id that changes every day, no IP address or browser details kept; a visit is tied to a cart when something is added to it, so a sale gets its channel), and your cookie page says so."}
        </p>
      </section>
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
        noteAction={memberCan(current, "owner") ? saveStoreCookieNoteAction.bind(null, store.slug) : null}
      />
      <ConsentLog consents={consents} />
    </div>
  );
}
