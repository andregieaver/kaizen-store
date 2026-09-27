import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { Host } from "@/server/hosts";

const field = "flex flex-col gap-1 text-sm font-medium";
const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** A host's details (D71): who they are, the store's commission, and whether they charge VAT. */
export function HostForm({ host, action }: { host: Host | null; action: (state: FormState, formData: FormData) => Promise<FormState> }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5">
      <label className={field}>
        Name
        <input name="name" required maxLength={120} defaultValue={host?.name ?? ""} className={control} />
        <span className="font-normal text-muted">Shown to shoppers on the host&apos;s listings, such as “Kari’s cabins”.</span>
      </label>
      {!host && (
        <label className={field}>
          Email
          <input name="email" type="email" required maxLength={200} className={control} />
          <span className="font-normal text-muted">
            They sign in with it at the store admin&apos;s sign-in page, and see only their own listings and bookings.
          </span>
        </label>
      )}
      <label className={`${field} max-w-xs`}>
        <span>
          Your commission <span className="font-normal text-muted">(%)</span>
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
        <span className="font-normal text-muted">The store&apos;s share of each booking, before Kaizen&apos;s fee. The host is paid the rest.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="vatRegistered" defaultChecked={host?.vatRegistered ?? false} className="mt-0.5 size-4" />
        <span>
          VAT registered
          <span className="block text-muted">
            If not, their listings are sold without VAT. If they are, each listing uses its own VAT category.
          </span>
        </span>
      </label>
      <div>
        <SubmitButton>{host ? "Save" : "Add host"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
