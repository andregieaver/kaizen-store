import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { HoursEditor } from "@/components/admin/hours-editor";
import type { FormState } from "@/components/admin/action-form";
import type { BookingResource } from "@/server/bookings";
import { CARD_CLASS } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";
import type { BookingsMessages } from "@/lib/admin-messages/bookings.en";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** A member of staff who takes appointments (D65): who they are, how many at once, and their hours. */
export function StaffForm({
  staff,
  action,
  words = adminText("en", "bookings").staffForm,
}: {
  staff: BookingResource | null;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The form's words (D312 A11); English when none are given. */
  words?: BookingsMessages["staffForm"];
}) {
  const w = words;
  return (
    <ActionForm action={action} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
      <label className={field}>
        {w.name}
        <input name="name" required maxLength={120} defaultValue={staff?.name ?? ""} className={control} />
        <span className="font-normal text-muted">{w.nameHint}</span>
      </label>
      <label className={field}>
        {w.email} <span className="font-normal text-muted">{w.optional}</span>
        <input name="email" type="email" maxLength={200} defaultValue={staff?.email ?? ""} className={control} />
        <span className="font-normal text-muted">{w.emailHint}</span>
      </label>
      <label className={`${field} max-w-xs`}>
        {w.atOnce}
        <input name="capacity" type="number" min={1} max={500} required defaultValue={staff?.capacity ?? 1} className={control} />
        <span className="font-normal text-muted">{w.atOnceHint}</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={staff?.active ?? true} className="size-4" />
        {w.takes}
      </label>
      <div className="border-t border-line pt-4">
        <h2 className="mb-1 text-title text-ink">{w.hours}</h2>
        <p className="mb-3 text-sm text-muted">{w.hoursHint}</p>
        <HoursEditor name="hours" initial={staff?.hours ?? null} />
      </div>
      <div>
        <SubmitButton>{staff ? w.save : w.add}</SubmitButton>
      </div>
    </ActionForm>
  );
}
