import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AUTOPILOT_TABS, AutopilotPage, type AutopilotTab } from "@/components/admin/autopilot/autopilot-page";
import { adminLangOf } from "@/lib/admin-lang";
import { adminTexts } from "@/lib/admin-text";
import { autopilotOverview } from "@/server/autopilot-overview";
import { holderOfPrincipal } from "@/server/owner-assistant";
import { requireOwnerRole } from "@/server/permissions";

import { answerStepAction, cancelFollowUpAction, changePlanAction, decideCallAction, dropGoalAction, saveSettingsAction } from "./actions";

export const metadata: Metadata = { title: "Autopilot" };

/** The store's Autopilot (D309): what waits for the owner, the plans, the goals and how far it may go. For owners, as the AI manager is. */
export default async function StoreAutopilotPage({ params, searchParams }: PageProps<"/admin/[store]/assistant/autopilot">) {
  const member = await requireOwnerRole((await params).store);
  const { tab } = await searchParams;
  const lang = adminLangOf(member.account.adminLocale ?? null);
  const overview = await autopilotOverview({ account: member.account, store: member.store, holder: holderOfPrincipal(member) });
  const slug = member.store.slug;
  const base = `/admin/${slug}/assistant/autopilot`;
  return (
    <AdminTextScope texts={adminTexts(lang, ["assistant"])}>
      <AutopilotPage
        overview={overview}
        base={base}
        assistantHref={`/admin/${slug}/assistant`}
        siteName={member.store.name}
        tab={(AUTOPILOT_TABS as readonly string[]).includes(String(tab)) ? (tab as AutopilotTab) : "decisions"}
        lang={lang}
        links={{ payments: `/admin/${slug}/settings/payments`, plan: `/admin/${slug}/billing` }}
        actions={{
          decide: decideCallAction.bind(null, slug),
          answer: answerStepAction.bind(null, slug),
          plan: changePlanAction.bind(null, slug),
          dropGoal: dropGoalAction.bind(null, slug),
          settings: saveSettingsAction.bind(null, slug),
          cancelFollowUp: cancelFollowUpAction.bind(null, slug),
        }}
      />
    </AdminTextScope>
  );
}
