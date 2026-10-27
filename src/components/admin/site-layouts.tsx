"use client";

import type { SiteLayoutType } from "@/server/site-layouts";
import type { PageSummary } from "@/server/pages";

import { ActionForm, SubmitButton, type FormState } from "./action-form";
import { Card, CARD_CLASS, Chip, List, ListRow, RowLead } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";

import type { ScheduleChip } from "@/lib/page-schedules";

import { useAdminLang, useAdminText } from "./admin-text";
import { ScheduleChipView } from "./pages-table";

/**
 * A site's headers or footers (D80), Kaizen's or a store's: which one it
 * shows, and the list to edit them.
 */


/** Which header or footer the site shows: the standard one, or one of its published ones. */
export function SiteLayoutChoice({
  type,
  layouts,
  current,
  siteName,
  action,
}: {
  type: SiteLayoutType;
  layouts: PageSummary[];
  current: string | null;
  /** "Your store" or "Kaizen's pages". */
  siteName: string;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const w = useAdminText("website").list;
  const choices = layouts.filter((layout) => layout.state !== "draft" || layout.id === current);
  const unpublished = layouts.find((layout) => layout.id === current)?.state === "draft";
  return (
    <ActionForm action={action} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
      <h2 className="text-title text-ink">{w.inUseTitle[type]}</h2>
      <p className="max-w-2xl text-sm text-muted">{fillWords(w.inUseHint[type], { site: siteName })}</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-col gap-1 text-sm font-medium">
          {fillWords(w.shows, { site: siteName })}
          <select name="layout" defaultValue={current ?? ""} className="min-h-10 rounded-md border border-line bg-card px-3 text-sm font-normal">
            <option value="">{w.standard[type]}</option>
            {choices.map((layout) => (
              <option key={layout.id} value={layout.id}>
                {layout.title || w.untitled}
                {layout.state === "draft" ? w.notPublished : ""}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton>{w.save}</SubmitButton>
      </div>
      {unpublished && <p className="text-sm text-muted">{w.layoutUnpublished[type]}</p>}
    </ActionForm>
  );
}

/** The site's headers or footers: name, state, and which is in use. */
export function SiteLayoutsTable({
  layouts,
  adminBase,
  current,
  schedules = {},
}: {
  layouts: PageSummary[];
  adminBase: string;
  current: string | null;
  /** What is scheduled for each header or footer or did not happen (D340), by page id. */
  schedules?: Record<string, ScheduleChip>;
}) {
  const w = useAdminText("website").list;
  const date = new Intl.DateTimeFormat(ADMIN_LANG_FACTS[useAdminLang()].locale, { dateStyle: "medium" });
  return (
    <Card compact>
      <List>
        {layouts.map((layout) => (
          <ListRow key={layout.id} href={`${adminBase}/${layout.id}`}>
            <RowLead
              title={layout.title || w.untitled}
              sub={layout.publishedAt ? fillWords(w.publishedOn, { date: date.format(new Date(layout.publishedAt)) }) : undefined}
            />
            {layout.id === current && (
              <Chip signal="positive" dot>
                {w.inUse}
              </Chip>
            )}
            <Chip signal={layout.state === "draft" ? "neutral" : layout.state === "changed" ? "warning" : "positive"}>{w.layoutStates[layout.state]}</Chip>
            {schedules[layout.id] && <ScheduleChipView chip={schedules[layout.id]} />}
          </ListRow>
        ))}
      </List>
    </Card>
  );
}
