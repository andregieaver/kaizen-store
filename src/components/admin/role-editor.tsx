import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { AREA_LABELS, WORKING_AREAS, levelIn, type AreaLevel } from "@/lib/permissions";
import { LEVELS, levelField } from "@/lib/role-form";

const field = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/**
 * One role's form (wave 1, 1f, `docs/wave-1-trust.md` 2.7): a name and, for each working area, no access, can view or can change. Team and
 * Billing are shown but cannot be chosen: only an owner changes the team or the plan, and the server and the database refuse them in a role
 * whatever the form says. A plain form of radio buttons, so it works without scripts; `ActionForm` keeps what was typed when a check fails.
 */
export function RoleEditor({
  action,
  role,
  submitLabel,
  idPrefix,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  /** The role being changed; none for a new one. */
  role?: { name: string; permissions: readonly string[] };
  submitLabel: string;
  /** Makes the field ids unique where several editors share a page. */
  idPrefix: string;
}) {
  return (
    <ActionForm action={action} className="flex flex-col gap-4">
      <label className="flex max-w-sm flex-col gap-1 text-sm font-medium">
        Name
        <input name="name" required maxLength={60} defaultValue={role?.name ?? ""} autoComplete="off" className={field} />
      </label>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-left text-sm">
          <caption className="sr-only">What this role can do in each part of the admin</caption>
          <thead>
            <tr className="border-b border-border text-muted">
              <th scope="col" className="py-2 pr-4 font-medium">
                Area
              </th>
              {LEVELS.map(({ level, label }) => (
                <th key={level} scope="col" className="px-3 py-2 text-center font-medium">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {WORKING_AREAS.map((area) => {
              const chosen: AreaLevel = levelIn(role?.permissions ?? [], area);
              return (
                <tr key={area}>
                  <th scope="row" className="py-2 pr-4 font-normal">
                    {AREA_LABELS[area]}
                  </th>
                  {LEVELS.map(({ level, label }) => (
                    <td key={level} className="px-3 py-2 text-center">
                      <input
                        type="radio"
                        id={`${idPrefix}-${area}-${level}`}
                        name={levelField(area)}
                        value={level}
                        defaultChecked={chosen === level}
                        aria-label={`${AREA_LABELS[area]}: ${label.toLowerCase()}`}
                        className="size-4"
                      />
                    </td>
                  ))}
                </tr>
              );
            })}
            {(["staff", "billing"] as const).map((area) => (
              <tr key={area} className="text-muted">
                <th scope="row" className="py-2 pr-4 font-normal">
                  {AREA_LABELS[area]}
                </th>
                <td colSpan={3} className="px-3 py-2 text-center">
                  Owners only: a role cannot give this
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">Can change includes can view. A page the role cannot open is hidden from its navigation.</p>
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
