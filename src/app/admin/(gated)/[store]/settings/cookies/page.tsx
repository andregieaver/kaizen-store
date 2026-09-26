import type { Metadata } from "next";

import { ConsentLog, TrackingForm } from "@/components/admin/cookie-settings";
import { marketPath } from "@/lib/paths";
import { requireMember } from "@/server/auth";
import { listConsents } from "@/server/consents";

import { saveStoreTrackingAction } from "./actions";

export const metadata: Metadata = { title: "Cookies and tracking" };

/** The store's cookies, tools and consents (D58). */
export default async function StoreCookiesPage({ params }: PageProps<"/admin/[store]/settings/cookies">) {
  const { store } = await requireMember((await params).store);
  const market = store.markets[0];
  const consents = await listConsents(store.id);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Cookies and tracking</h1>
        <p className="max-w-2xl text-sm text-muted">
          What your store stores in shoppers&apos; browsers, the tools you use to measure and market, and the choices
          shoppers make about them. Your cookie page lists every cookie, in each of your languages.
        </p>
      </div>
      <TrackingForm
        tracking={store.tracking}
        action={saveStoreTrackingAction.bind(null, store.slug)}
        cookiePage={market ? marketPath(store.slug, market.slug, "/cookies") : "/"}
      />
      <ConsentLog consents={consents} />
    </div>
  );
}
