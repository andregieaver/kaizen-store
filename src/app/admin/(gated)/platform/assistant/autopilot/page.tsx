import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AUTOPILOT_TABS, AutopilotPage, type AutopilotTab } from "@/components/admin/autopilot/autopilot-page";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { adminLangOf } from "@/lib/admin-lang";
import { adminTexts } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { autopilotOverview } from "@/server/autopilot-overview";

import { answerStepAction, cancelFollowUpAction, changePlanAction, decideCallAction, dropGoalAction, saveSettingsAction, setSignupGoalAction } from "./actions";

export const metadata: Metadata = { title: "Autopilot" };

/** Kaizena Flow's own Autopilot (D309): for platform admins. */
export default async function PlatformAutopilotPage({ searchParams }: PageProps<"/admin/platform/assistant/autopilot">) {
  const account = await requirePlatformAdmin();
  const { tab } = await searchParams;
  const lang = adminLangOf(account.adminLocale ?? null);
  const overview = await autopilotOverview({ account, store: null });
  return (
    <AdminTextScope texts={adminTexts(lang, ["assistant"])}>
      <AutopilotPage
        timeZone={PLATFORM_TIME_ZONE}
        overview={overview}
        base="/admin/platform/assistant/autopilot"
        assistantHref="/admin/platform/assistant"
        siteName="Kaizena Flow"
        tab={(AUTOPILOT_TABS as readonly string[]).includes(String(tab)) ? (tab as AutopilotTab) : "decisions"}
        lang={lang}
        links={{}}
        actions={{
          decide: decideCallAction,
          answer: answerStepAction,
          plan: changePlanAction,
          dropGoal: dropGoalAction,
          setSignupGoal: setSignupGoalAction,
          settings: saveSettingsAction,
          cancelFollowUp: cancelFollowUpAction,
        }}
      />
    </AdminTextScope>
  );
}
