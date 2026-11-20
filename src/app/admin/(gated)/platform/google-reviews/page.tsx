import type { Metadata } from "next";


import { GoogleReviewsSettings } from "@/components/admin/google-reviews-settings";
import { getGoogleSettings } from "@/server/google-reviews";
import { PageHeader } from "@/components/admin/ui";

import { choosePlatformPlaceAction, findPlatformPlacesAction, removePlatformGoogleAction, savePlatformGoogleKeyAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";
import { AdminAreas } from "@/components/admin/admin-areas";
import { NOTIFICATIONS_WORDS } from "@/lib/admin-words/notifications";
import { NOTIFICATIONS_GOOGLE_WORDS } from "@/lib/admin-words/notifications-google";

export const metadata: Metadata = { title: "Google reviews" };

/** Kaizen's own Google reviews (D91), for testimonials on Kaizen's pages; stores set up their own. */
export default async function PlatformGoogleReviewsPage() {
  const { w, lang } = await platformSiteWords();
  const settings = await getGoogleSettings(null);
  return (
    <AdminAreas areas={{ notificationsGoogle: NOTIFICATIONS_GOOGLE_WORDS }}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.misc.googleReviews.title}
        description={<><span className="sm:hidden">{NOTIFICATIONS_WORDS[lang].google.phone.lead}</span><span className="max-sm:hidden">{w.misc.googleReviews.description}</span></>}
      />
      <GoogleReviewsSettings
        hint={settings?.hint ?? null}
        place={settings?.place ?? null}
        actions={{
          saveKey: savePlatformGoogleKeyAction,
          search: findPlatformPlacesAction,
          choose: choosePlatformPlaceAction,
          remove: removePlatformGoogleAction,
        }}
      />
    </div>
    </AdminAreas>
  );
}
