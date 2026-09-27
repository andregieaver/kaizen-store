import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { FormState } from "@/components/admin/action-form";
import type { BookingResource } from "@/server/bookings";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** A room or home booked by the night, or an item rented by the day (D67): its name and how many there are. */
export function UnitForm({
  kind,
  unit,
  hosts = [],
  action,
}: {
  kind: "unit" | "item";
  unit: BookingResource | null;
  /** The store's hosts (D71): a room or item may be one of theirs. */
  hosts?: { id: string; name: string }[];
  action: (state: FormState, formData: FormData) => Promise<FormState>;
}) {
  const stay = kind === "unit";
  return (
    <ActionForm action={action} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <label className={field}>
        Name
        <input name="name" required maxLength={120} defaultValue={unit?.name ?? ""} className={control} />
        <span className="font-normal text-muted">
          {stay ? "Such as “Room 2” or “The cabin”." : "Such as “City bike” or “Kayak”."} Shoppers see it on their booking.
        </span>
      </label>
      <label className={`${field} max-w-xs`}>
        {stay ? "Bookings at once" : "How many there are"}
        <input name="capacity" type="number" min={1} max={500} required defaultValue={unit?.capacity ?? 1} className={control} />
        <span className="font-normal text-muted">
          {stay ? "1 for a room or a home; more for beds in a dormitory." : "Each booking takes one of them."}
        </span>
      </label>
      {hosts.length > 0 && (
        <label className={`${field} max-w-xs`}>
          Host
          <select name="hostId" defaultValue={unit?.hostId ?? ""} className={control}>
            <option value="">The store itself</option>
            {hosts.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
          <span className="font-normal text-muted">A host keeps the calendar of their own rooms and items.</span>
        </label>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={unit?.active ?? true} className="size-4" />
        Takes bookings
      </label>
      <div>
        <SubmitButton>{unit ? "Save" : "Add"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
