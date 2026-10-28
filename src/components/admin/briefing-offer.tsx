import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { briefingOffered } from "@/server/staff-alerts";

type Action = Parameters<typeof ActionForm>[0]["action"];

/**
 * The briefing offered once on a store's Home (wave 8 unit D, D348; decision 5: off until an owner turns it on): *Weekly*, *Daily* or *Not now*, each
 * one press. Read after the page is shown and drawn only while the briefing is off and no owner said *Not now*; a failed read draws nothing.
 */
export async function BriefingOffer({ storeId, lang, turnOn, dismiss }: { storeId: string; lang: AdminLang; turnOn: Action; dismiss: Action }) {
  let offered = false;
  try {
    offered = await briefingOffered(storeId);
  } catch {
    return null;
  }
  if (!offered) return null;
  const w = adminText(lang, "home").briefing;
  return (
    <Card title={w.title} description={w.description}>
      <div className="flex flex-wrap items-center gap-3" data-briefing-offer>
        <ActionForm action={turnOn} replaceOnSuccess successMessage={w.on}>
          <input type="hidden" name="kind" value="weekly" />
          <SubmitButton>{w.weekly}</SubmitButton>
        </ActionForm>
        <ActionForm action={turnOn} replaceOnSuccess successMessage={w.on}>
          <input type="hidden" name="kind" value="daily" />
          <SubmitButton variant="secondary">{w.daily}</SubmitButton>
        </ActionForm>
        <ActionForm action={dismiss} replaceOnSuccess successMessage={w.dismissed}>
          <SubmitButton variant="secondary">{w.notNow}</SubmitButton>
        </ActionForm>
      </div>
    </Card>
  );
}
