import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { FormState } from "@/components/admin/action-form";
import type { BookingResource } from "@/server/bookings";
import { CARD_CLASS } from "@/components/admin/ui";
import { adminText } from "@/lib/admin-text";
import type { BookingsMessages } from "@/lib/admin-messages/bookings.en";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/** A room or home booked by the night, or an item rented by the day (D67): its name and how many there are. */
export function UnitForm({
  kind,
  unit,
  hosts = [],
  action,
  words = adminText("en", "bookings").unitForm,
}: {
  kind: "unit" | "item";
  unit: BookingResource | null;
  /** The store's hosts (D71): a room or item may be one of theirs. */
  hosts?: { id: string; name: string }[];
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The form's words (D312 A11); English when none are given. */
  words?: BookingsMessages["unitForm"];
}) {
  const w = words;
  const stay = kind === "unit";
  return (
    <ActionForm action={action} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
      <label className={field}>
        {w.name}
        <input name="name" required maxLength={120} defaultValue={unit?.name ?? ""} className={control} />
        <span className="font-normal text-muted">
          {stay ? w.nameRoom : w.nameItem}
        </span>
      </label>
      <label className={`${field} max-w-xs`}>
        {stay ? w.atOnce : w.howMany}
        <input name="capacity" type="number" min={1} max={500} required defaultValue={unit?.capacity ?? 1} className={control} />
        <span className="font-normal text-muted">
          {stay ? w.atOnceHint : w.howManyHint}
        </span>
      </label>
      {hosts.length > 0 && (
        <label className={`${field} max-w-xs`}>
          {w.host}
          <select name="hostId" defaultValue={unit?.hostId ?? ""} className={control}>
            <option value="">{w.storeItself}</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <span className="font-normal text-muted">{w.hostHint}</span>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={unit?.active ?? true} className="size-4" />
        {w.takes}
      </label>
      <div>
        <SubmitButton>{unit ? w.save : w.add}</SubmitButton>
      </div>
    </ActionForm>
  );
}
