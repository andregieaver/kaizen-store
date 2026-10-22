"use client";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { AUTO_ARCHIVE_MAX_DAYS, AUTO_ARCHIVE_MIN_DAYS, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN, GIFT_MESSAGE_MAX, GIFT_NAME_MAX } from "@/lib/order-limits";
import { CAPTURE_SETTINGS, DEFAULT_HOLD_DAYS } from "@/lib/capture";
import type { OrderSettings } from "@/server/order-settings";

const input = "min-h-10 w-28 rounded-md border border-line bg-card px-3 text-sm disabled:opacity-60";
const card = "flex flex-col gap-3 rounded-lg border border-line bg-card p-5";
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
        <section aria-labelledby="gift" className={card}>
          <h2 id="gift" className="text-title text-ink">
            {w.giftTitle}
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="giftMessages" defaultChecked={settings.giftMessages} className="mt-0.5 size-4" />
            <span>{w.gift}</span>
          </label>
          <p className={hint}>{fillWords(w.giftHint, { name: GIFT_NAME_MAX, message: GIFT_MESSAGE_MAX })}</p>
        </section>

        <section aria-labelledby="archive" className={card}>
          <h2 id="archive" className="text-title text-ink">
            {w.archiveTitle}
          </h2>
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
        </section>

        <section aria-labelledby="links" className={card}>
          <h2 id="links" className="text-title text-ink">
            {w.draftsTitle}
          </h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {w.draftDays}{" "}
            <span className="font-normal text-muted">{fillWords(w.range, { min: DRAFT_VALID_DAYS_MIN, max: DRAFT_VALID_DAYS_MAX })}</span>
            <input name="draftValidDays" type="number" inputMode="numeric" min={DRAFT_VALID_DAYS_MIN} max={DRAFT_VALID_DAYS_MAX} defaultValue={settings.draftValidDays} required className={input} />
          </label>
          <p className={hint}>{w.draftHint}</p>
        </section>

        <section aria-labelledby="outside" className={card}>
          <h2 id="outside" className="text-title text-ink">
            {w.outsideTitle}
          </h2>
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
        </section>

        <section aria-labelledby="capture" className={card}>
          <h2 id="capture" className="text-title text-ink">
            {w.captureTitle}
          </h2>
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
        </section>

        <div>
          <SubmitButton disabled={!canEdit}>{w.save}</SubmitButton>
          {!canEdit && <p className={`${hint} mt-2`}>{w.readOnly}</p>}
        </div>
      </fieldset>
    </ActionForm>
  );
}
