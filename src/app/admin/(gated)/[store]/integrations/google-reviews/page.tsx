import type { Metadata } from "next";
import Link from "next/link";

import { GoogleReviewsSettings } from "@/components/admin/google-reviews-settings";
import { requireMember } from "@/server/auth";
import { getGoogleSettings } from "@/server/google-reviews";

import { chooseStorePlaceAction, findStorePlacesAction, removeStoreGoogleAction, saveStoreGoogleKeyAction } from "./actions";

export const metadata: Metadata = { title: "Google reviews" };

/** The store's Google reviews (D91), shown by testimonials components set to Google. */
export default async function StoreGoogleReviewsPage({ params }: PageProps<"/admin/[store]/integrations/google-reviews">) {
  const { store, role } = await requireMember((await params).store);
  const settings = await getGoogleSettings(store.id);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/integrations`} className="text-sm underline">
          Integrations
        </Link>
        <h1 className="text-2xl font-semibold">Google reviews</h1>
        <p className="text-sm text-muted">
          Show your business&apos;s rating and reviews on Google with a Testimonials component set to Google reviews. They are asked of
          Google as each page is shown and never kept, as Google&apos;s terms ask; nothing about your visitors is sent.
        </p>
      </div>
      {role === "owner" ? (
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
        <p className="text-sm">{settings?.place ? `Showing reviews of ${settings.place.name}.` : "Not set up."} Only an owner can change it.</p>
      )}
    </div>
  );
}
