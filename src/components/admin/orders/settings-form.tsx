import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { AUTO_ARCHIVE_MAX_DAYS, AUTO_ARCHIVE_MIN_DAYS, DRAFT_VALID_DAYS_MAX, DRAFT_VALID_DAYS_MIN, GIFT_MESSAGE_MAX, GIFT_NAME_MAX } from "@/lib/order-limits";
import type { OrderSettings } from "@/server/order-settings";

const input = "min-h-10 w-28 rounded-md border border-border bg-background px-3 text-sm disabled:opacity-60";
const card = "flex flex-col gap-3 rounded-lg border border-border bg-background p-5";
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
  return (
    <ActionForm action={action} successMessage="Saved." className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="gift" className={card}>
          <h2 id="gift" className="font-medium">
            Gift messages
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="giftMessages" defaultChecked={settings.giftMessages} className="mt-0.5 size-4" />
            <span>Let shoppers mark an order as a gift and write a message.</span>
          </label>
          <p className={hint}>
            The cart then shows a tick box with three fields: To (up to {GIFT_NAME_MAX} characters), From (up to {GIFT_NAME_MAX}) and a message (up to {GIFT_MESSAGE_MAX} characters). The message is printed on the
            order&apos;s packing slip, which has no prices, so the parcel can carry it. Kaizen does not send the message to anyone: it is kept with the order, shown to you and to the buyer, and erased with the order&apos;s personal data. It
            is never in the shipping notice.
          </p>
        </section>

        <section aria-labelledby="archive" className={card}>
          <h2 id="archive" className="font-medium">
            Automatic archiving
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="autoArchive" defaultChecked={settings.autoArchiveDays !== null} className="mt-0.5 size-4" />
            <span>Archive orders that need no more work.</span>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            After this many days without news{" "}
            <span className="font-normal text-muted">
              {AUTO_ARCHIVE_MIN_DAYS} to {AUTO_ARCHIVE_MAX_DAYS}
            </span>
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
          <p className={hint}>
            Off by default. An order is archived when it has been sent (or has nothing to send), has no return open and has had no event for that many days. Archiving only moves an order out of the default list: it changes no
            amount, number, invoice or figure, and you can unarchive it. A return or a withdrawal on an archived order brings it back. Waiting for the 14-day right of withdrawal is why the shortest is {AUTO_ARCHIVE_MIN_DAYS} days.
          </p>
        </section>

        <section aria-labelledby="links" className={card}>
          <h2 id="links" className="font-medium">
            Draft orders
          </h2>
          <label className="flex flex-col gap-1 text-sm font-medium">
            A draft order&apos;s pay link is valid for (days){" "}
            <span className="font-normal text-muted">
              {DRAFT_VALID_DAYS_MIN} to {DRAFT_VALID_DAYS_MAX}
            </span>
            <input name="draftValidDays" type="number" inputMode="numeric" min={DRAFT_VALID_DAYS_MIN} max={DRAFT_VALID_DAYS_MAX} defaultValue={settings.draftValidDays} required className={input} />
          </label>
          <p className={hint}>
            This is the default when you send a draft; you can change it for one draft in the send dialog. The stock on a draft is held from the moment it is sent until the link expires. The price on the link does not change when the
            catalogue prices change.
          </p>
        </section>

        <section aria-labelledby="outside" className={card}>
          <h2 id="outside" className="font-medium">
            Money taken outside Kaizen
          </h2>
          {isOwner ? (
            <>
              <input type="hidden" name="staffMarkPaidShown" value="1" />
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="staffMarkPaid" defaultChecked={settings.staffMarkPaid} className="mt-0.5 size-4" />
                <span>Staff may record a payment taken outside Kaizen, and record a refund of one.</span>
              </label>
            </>
          ) : (
            <p className="text-sm">{settings.staffMarkPaid ? "Staff may record a payment taken outside Kaizen." : "Only the owner can record a payment taken outside Kaizen."}</p>
          )}
          <p className={hint}>
            On a draft order you can record that the customer paid by bank transfer, in cash or another way. Kaizen then treats the order as paid, issues the invoice (which says it was paid outside the online checkout) and sends the
            confirmation, but it did not touch the money and takes no sale fee on it. A refund of such an order is only recorded here: you pay the customer back yourself. Cash taken when goods are handed over is a cash sale under
            the cash register rules in many countries. Record it here only if your accountant says this is allowed. Recording a payment here does not replace a cash register.
          </p>
          {isOwner ? null : <p className={hint}>Only the owner can change this choice.</p>}
        </section>

        <div>
          <SubmitButton disabled={!canEdit}>Save</SubmitButton>
          {!canEdit && <p className={`${hint} mt-2`}>You can read these settings but not change them.</p>}
        </div>
      </fieldset>
    </ActionForm>
  );
}
