import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { wallClock, type ScheduleFacts, type ScheduleFormAction } from "@/lib/page-schedules";

import { Card } from "./ui";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm font-normal";

/**
 * *Make it live later* on an installed theme's page (wave 7 unit F, D340): a day and a time on the store's clock (tomorrow at nine to start
 * with, so Homer only presses Schedule), and *Put the theme before back later* behind a disclosure for Lisa. Shows what is planned for this
 * theme or did not happen, with *Cancel the schedule*. Server-drawn: the disclosure works without JavaScript.
 */
export function ThemeScheduleCard({
  zone,
  facts,
  schedule,
  cancel,
  lang = "en",
  now = new Date(),
}: {
  zone: string;
  /** What is planned for this theme, or did not happen (`themeFactsFor()`); null: nothing. */
  facts: ScheduleFacts | null;
  schedule: ScheduleFormAction<FormState>;
  cancel: ScheduleFormAction<FormState>;
  lang?: AdminLang;
  now?: Date;
}) {
  const all = adminText(lang, "schedules");
  const w = all.theme;
  const when = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "long", timeStyle: "short", timeZone: zone });
  const at = (iso: string) => when.format(new Date(iso));
  const start = wallClock(new Date(now.getTime() + 86_400_000), zone);
  const back = wallClock(new Date(now.getTime() + 8 * 86_400_000), zone);
  return (
    <Card title={w.title} description={fillWords(w.description, { zone })} compact>
      <div className="flex flex-col gap-4" data-theme-schedule="">
        {facts?.publishAt && <p className="text-sm text-ink">{fillWords(all.chips.themeLive, { when: at(facts.publishAt) })}</p>}
        {facts?.revertAt && <p className="text-sm text-ink">{fillWords(w.goesBack, { when: at(facts.revertAt) })}</p>}
        {facts?.failure && (
          <p className="rounded-panel bg-warning-soft p-3 text-sm text-warning-text">
            {fillWords(facts.failure.leg === "publish" ? w.failed : w.failedBack, { when: at(facts.failure.at), problem: facts.failure.problem })}
          </p>
        )}
        <ActionForm action={schedule} className="flex flex-col gap-3">
          <div className="grid max-w-md grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              {all.dialog.day}
              <input type="date" name="day" defaultValue={start.day} required className={input} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              {all.dialog.time}
              <input type="time" name="time" defaultValue="09:00" required className={input} />
            </label>
          </div>
          <details>
            <summary className="cursor-pointer text-sm font-medium">{w.back}</summary>
            <div className="mt-3 flex max-w-md flex-col gap-3">
              <p className="text-sm text-muted">{w.backHint}</p>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="back" className="size-4" />
                {w.back}
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {all.dialog.backDay}
                  <input type="date" name="backDay" defaultValue={back.day} className={input} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {all.dialog.backTime}
                  <input type="time" name="backTime" defaultValue="09:00" className={input} />
                </label>
              </div>
            </div>
          </details>
          <div>
            <SubmitButton>{w.save}</SubmitButton>
          </div>
        </ActionForm>
        {(facts?.publishAt || facts?.revertAt) && (
          <ActionForm action={cancel}>
            <SubmitButton variant="secondary">{w.cancel}</SubmitButton>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
