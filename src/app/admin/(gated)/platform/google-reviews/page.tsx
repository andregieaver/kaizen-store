import type { Metadata } from "next";

import { GoogleReviewsSettings } from "@/components/admin/google-reviews-settings";
import { getGoogleSettings } from "@/server/google-reviews";

import { choosePlatformPlaceAction, findPlatformPlacesAction, removePlatformGoogleAction, savePlatformGoogleKeyAction } from "./actions";

export const metadata: Metadata = { title: "Google reviews" };

/** Kaizen's own Google reviews (D91), for testimonials on Kaizen's pages; stores set up their own. */
export default async function PlatformGoogleReviewsPage() {
  const settings = await getGoogleSettings(null);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Google reviews</h1>
        <p className="text-sm text-muted">
          Kaizen&apos;s rating and reviews on Google, for Testimonials components on Kaizen&apos;s own pages. Stores set up their own under
          Integrations.
        </p>
      </div>
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
  );
}
