import type { Metadata } from "next";

import { GoogleReviewsSettings } from "@/components/admin/google-reviews-settings";
import { memberCan, requirePermission } from "@/server/permissions";
import { getGoogleSettings } from "@/server/google-reviews";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { chooseStorePlaceAction, findStorePlacesAction, removeStoreGoogleAction, saveStoreGoogleKeyAction } from "./actions";

export const metadata: Metadata = { title: "Google reviews" };

/** The store's Google reviews (D91), shown by testimonials components set to Google. */
export default async function StoreGoogleReviewsPage({ params }: PageProps<"/admin/[store]/integrations/google-reviews">) {
  const current = await requirePermission((await params).store, "settings:read");
  const { store } = current;
  const lang = adminLangOf(current.account.adminLocale);
  const w = adminText(lang, "notifications").google;
  const settings = await getGoogleSettings(store.id);
  return (
    <AdminTextScope texts={adminTexts(lang, ["notifications"])}>
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/integrations`, label: w.back }} title={w.title} description={<>{w.description}</>} />
      {memberCan(current, "owner") ? (
        <GoogleReviewsSettings
          hint={settings?.hint ?? null}
          place={settings?.place ?? null}
          actions={{
            saveKey: saveStoreGoogleKeyAction.bind(null, store.slug),
            search: findStorePlacesAction.bind(null, store.slug),
            choose: chooseStorePlaceAction.bind(null, store.slug),
            remove: removeStoreGoogleAction.bind(null, store.slug),
          }}
        />
      ) : (
        <p className="text-sm">
          {settings?.place ? fillWords(w.showing, { name: settings.place.name }) : w.notSetUp} {w.ownerOnly}
        </p>
      )}
    </div>
    </AdminTextScope>
  );
}
