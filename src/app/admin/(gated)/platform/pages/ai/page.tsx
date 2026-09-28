import type { Metadata } from "next";

import { PageStudioView } from "@/components/admin/page-studio-view";
import { studioAbilities } from "@/server/page-ai";

import {
  platformStudioBuildAction,
  platformStudioHearAction,
  platformStudioPictureAction,
  platformStudioPlanAction,
  platformStudioSpeakAction,
  platformStudioTalkAction,
} from "./actions";

export const metadata: Metadata = { title: "Create a page with AI" };

/** Planning a page and writing its sections takes the site's AI a while (D92). */
export const maxDuration = 300;

/** Kaizen's own pages with AI (D92); the platform layout admits only platform admins, and each action checks again. */
export default async function PlatformPageStudio() {
  const abilities = await studioAbilities(null);
  return (
    <PageStudioView
      actions={{
        talk: platformStudioTalkAction,
        plan: platformStudioPlanAction,
        build: platformStudioBuildAction,
        picture: platformStudioPictureAction,
        hear: abilities.hear ? platformStudioHearAction : null,
        speak: abilities.speak ? platformStudioSpeakAction : null,
      }}
      language="English"
      abilities={abilities}
      pagesHref="/admin/platform/pages"
      settingsHref="/admin/platform/ai"
    />
  );
}
