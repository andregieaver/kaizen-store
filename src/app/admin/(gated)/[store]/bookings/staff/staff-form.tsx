import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { HoursEditor } from "@/components/admin/hours-editor";
import type { FormState } from "@/components/admin/action-form";
import type { BookingResource } from "@/server/bookings";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** A member of staff who takes appointments (D65): who they are, how many at once, and their hours. */
export function StaffForm({
  staff,
  action,
}: {
  staff: BookingResource | null;
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <label className={field}>
        Name
        <input name="name" required maxLength={120} defaultValue={staff?.name ?? ""} className={control} />
        <span className="font-normal text-muted">Shoppers see it when they choose who to book with.</span>
      </label>
      <label className={field}>
        Email <span className="font-normal text-muted">(optional)</span>
        <input name="email" type="email" maxLength={200} defaultValue={staff?.email ?? ""} className={control} />
        <span className="font-normal text-muted">Where their bookings are sent. Not shown to shoppers.</span>
      </label>
      <label className={`${field} max-w-xs`}>
        Bookings at once
        <input name="capacity" type="number" min={1} max={500} required defaultValue={staff?.capacity ?? 1} className={control} />
        <span className="font-normal text-muted">1 for one person at a time; more for a class or a group.</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={staff?.active ?? true} className="size-4" />
        Takes bookings
      </label>
      <div className="border-t border-border pt-4">
        <h2 className="mb-1 text-sm font-medium">Working hours</h2>
        <p className="mb-3 text-sm text-muted">Appointments are offered only inside these, in the store&apos;s time zone.</p>
        <HoursEditor name="hours" initial={staff?.hours ?? null} />
      </div>
      <div>
        <SubmitButton>{staff ? "Save" : "Add"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
