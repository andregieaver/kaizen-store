import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { Host } from "@/server/hosts";
import { CARD_CLASS } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";
import type { BookingsMessages } from "@/lib/admin-messages/bookings.en";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** A host's details (D71): who they are, the store's commission, and whether they charge VAT. */
export function HostForm({
  host,
  action,
  words: w = adminText("en", "bookings").hostForm,
}: {
  host: Host | null;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The form's words (D312 A11); English when none are given. */
  words?: BookingsMessages["hostForm"];
}) {
  return (
    <ActionForm action={action} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
      <label className={field}>
        {w.name}
        <input name="name" required maxLength={120} defaultValue={host?.name ?? ""} className={control} />
        <span className="font-normal text-muted">{w.nameHint}</span>
      </label>
      {!host && (
        <label className={field}>
          {w.email}
          <input name="email" type="email" required maxLength={200} className={control} />
          <span className="font-normal text-muted">{w.emailHint}</span>
        </label>
      )}
      <label className={`${field} max-w-xs`}>
        <span>
          {w.commission} <span className="font-normal text-muted">(%)</span>
        </span>
        <input
          name="commissionPercent"
          type="number"
          min={0}
          max={100}
          step={0.01}
          required
          defaultValue={host ? host.commissionBps / 100 : 15}
          className={control}
        />
        <span className="font-normal text-muted">{w.commissionHint}</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="vatRegistered" defaultChecked={host?.vatRegistered ?? false} className="mt-0.5 size-4" />
        <span>
          {w.vat}
          <span className="block text-muted">{w.vatHint}</span>
        </span>
      </label>
      <div>
        <SubmitButton>{host ? w.save : w.add}</SubmitButton>
      </div>
    </ActionForm>
  );
}
