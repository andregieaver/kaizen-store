import type { Metadata } from "next";

import { GoogleReviewsSettings } from "@/components/admin/google-reviews-settings";
import { getGoogleSettings } from "@/server/google-reviews";
import { PageHeader } from "@/components/admin/ui";

import { choosePlatformPlaceAction, findPlatformPlacesAction, removePlatformGoogleAction, savePlatformGoogleKeyAction } from "./actions";
import { platformSiteWords } from "@/server/platform-site-words";
import { AdminAreas } from "@/components/admin/admin-areas";

export const metadata: Metadata = { title: "Google reviews" };

/** Kaizen's own Google reviews (D91), for testimonials on Kaizen's pages; stores set up their own. */
export default async function PlatformGoogleReviewsPage() {
  const { w } = await platformSiteWords();
  const settings = await getGoogleSettings(null);
  return (
    <AdminAreas areas={["notifications"]}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.misc.googleReviews.title}
        description={w.misc.googleReviews.description}
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
