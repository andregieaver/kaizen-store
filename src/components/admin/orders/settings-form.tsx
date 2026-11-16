"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { FoldRow } from "@/components/admin/fold-row";
import { fillWords } from "@/lib/admin-fill";
import { submitClass } from "@/lib/submit-class";
import { AUTO_ARCHIVE_MAX_DAYS, AUTO_ARCHIVE_MIN_DAYS, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN, GIFT_MESSAGE_MAX, GIFT_NAME_MAX } from "@/lib/order-limits";
import { CAPTURE_SETTINGS, DEFAULT_HOLD_DAYS } from "@/lib/capture";
import { QUOTE_MODES } from "@/lib/quotes";
import type { OrderSettings } from "@/server/order-settings";

const input = "min-h-10 w-28 rounded-md border border-line bg-card px-3 text-sm disabled:opacity-60";
const hint = "text-sm text-muted";

/**
 * The order settings (wave 3, D173, `docs/wave-3-orders.md` 2.3). Plain fields in a form that works without a script; everything is checked again by the server. A person who may not
 * change settings sees them disabled; the choice of who may record money taken outside Kaizen is drawn as a choice only for the owner (it is the owner's alone, and says why).
 */
export function OrderSettingsForm({
  settings,
  canEdit,
  isOwner,
  action,
}: {
  settings: OrderSettings;
  canEdit: boolean;
  isOwner: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const w = useAdminText("payments").orders;
  return (
    <ActionForm action={action} successMessage={w.saved} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <ul className="divide-y divide-line rounded-lg border border-line bg-card px-5">
        <FoldRow title={w.giftTitle} sub={settings.giftMessages ? w.subOn : w.subOff} action={w.change}>
          <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="giftMessages" defaultChecked={settings.giftMessages} className="mt-0.5 size-4" />
            <span>{w.gift}</span>
          </label>
          <p className={hint}>{fillWords(w.giftHint, { name: GIFT_NAME_MAX, message: GIFT_MESSAGE_MAX })}</p>
          </div>
        </FoldRow>

        <FoldRow title={w.archiveTitle} sub={settings.autoArchiveDays === null ? w.subOff : fillWords(w.subArchive, { days: settings.autoArchiveDays })} action={w.change}>
          <div className="flex flex-col gap-3">
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="autoArchive" defaultChecked={settings.autoArchiveDays !== null} className="mt-0.5 size-4" />
            <span>{w.archive}</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.archiveDays}{" "}
            <span className="font-normal text-muted">{fillWords(w.range, { min: AUTO_ARCHIVE_MIN_DAYS, max: AUTO_ARCHIVE_MAX_DAYS })}</span>
            <input
              name="autoArchiveDays"
              type="number"
              inputMode="numeric"
              min={AUTO_ARCHIVE_MIN_DAYS}
              max={AUTO_ARCHIVE_MAX_DAYS}
              defaultValue={settings.autoArchiveDays ?? 30}
              className={input}
            />
          </label>
          <p className={hint}>{fillWords(w.archiveHint, { min: AUTO_ARCHIVE_MIN_DAYS })}</p>
          </div>
        </FoldRow>

        <FoldRow title={w.draftsTitle} sub={fillWords(w.subDraft, { days: settings.draftValidDays })} action={w.change}>
          <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.draftDays}{" "}
            <span className="font-normal text-muted">{fillWords(w.range, { min: DRAFT_VALID_DAYS_MIN, max: DRAFT_VALID_DAYS_MAX })}</span>
            <input name="draftValidDays" type="number" inputMode="numeric" min={DRAFT_VALID_DAYS_MIN} max={DRAFT_VALID_DAYS_MAX} defaultValue={settings.draftValidDays} required className={input} />
          </label>
          <p className={hint}>{w.draftHint}</p>
          </div>
        </FoldRow>

        <FoldRow title={w.quotesTitle} sub={w.quotes[settings.quoteRequests].label} action={w.change}>
          <div className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">{w.quotesLegend}</legend>
            {QUOTE_MODES.map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input type="radio" name="quoteRequests" value={value} defaultChecked={settings.quoteRequests === value} className="mt-0.5 size-4" />
                <span>
                  <span className="text-body-strong">{w.quotes[value].label}</span>
                  <span className="block text-muted">{w.quotes[value].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className={hint}>{w.quotesHint}</p>
          </div>
        </FoldRow>

        <FoldRow title={w.outsideTitle} sub={settings.staffMarkPaid ? w.outsideOn : w.subOwnerOnly} action={w.change}>
          <div className="flex flex-col gap-3">
          {isOwner ? (
            <>
              <input type="hidden" name="staffMarkPaidShown" value="1" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="staffMarkPaid" defaultChecked={settings.staffMarkPaid} className="mt-0.5 size-4" />
                <span>{w.outside}</span>
              </label>
            </>
          ) : (
            <p className="text-sm">{settings.staffMarkPaid ? w.outsideOn : w.outsideOff}</p>
          )}
          <p className={hint}>{w.outsideHint}</p>
          {isOwner ? null : <p className={hint}>{w.ownerChoice}</p>}
          </div>
        </FoldRow>

        <FoldRow title={w.captureTitle} sub={w.capture[settings.capture].label} action={w.change}>
          <div className="flex flex-col gap-3">
          {isOwner ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">{w.captureLegend}</legend>
              <input type="hidden" name="captureShown" value="1" />
              {CAPTURE_SETTINGS.map((value) => (
                <label key={value} className="flex items-start gap-2 text-sm">
                  <input type="radio" name="capture" value={value} defaultChecked={settings.capture === value} className="mt-0.5 size-4" />
                  <span>
                    <span className="text-body-strong">{w.capture[value].label}</span>
                    <span className="block text-muted">{w.capture[value].hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : (
            <p className="text-sm">{fillWords(w.charged, { when: w.capture[settings.capture].label.toLowerCase() })}</p>
          )}
          <p className={hint}>{fillWords(w.captureHint, { days: DEFAULT_HOLD_DAYS })}</p>
          {isOwner ? null : <p className={hint}>{w.ownerChoice}</p>}
          </div>
        </FoldRow>
        </ul>

        {/* Round 24 (D692): each setting a row saying its choice, opening in place; one Save right under them. */}
        <div>
          <SubmitButton disabled={!canEdit} className={`${submitClass("primary")} min-h-12 w-full font-medium sm:w-auto sm:min-w-56`}>{w.save}</SubmitButton>
          {!canEdit && <p className={`${hint} mt-2`}>{w.readOnly}</p>}
        </div>
      </fieldset>
    </ActionForm>
  );
}
