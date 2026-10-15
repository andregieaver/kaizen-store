import type { Metadata } from "next";

import { GoogleReviewsSettings } from "@/components/admin/google-reviews-settings";
import { getGoogleSettings } from "@/server/google-reviews";
import { PageHeader } from "@/components/admin/ui";

import { choosePlatformPlaceAction, findPlatformPlacesAction, removePlatformGoogleAction, savePlatformGoogleKeyAction } from "./actions";

export const metadata: Metadata = { title: "Google reviews" };

/** Kaizen's own Google reviews (D91), for testimonials on Kaizen's pages; stores set up their own. */
export default async function PlatformGoogleReviewsPage() {
  const settings = await getGoogleSettings(null);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Google reviews"
        description={<>Kaizena Flow&apos;s rating and reviews on Google, for Testimonials components on Kaizena Flow&apos;s own pages. Stores set up their own under Integrations.</>}
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
  );
}
