const control = "min-h-10 rounded-md border border-border bg-background px-3 font-normal";

/** The fields a company is made and edited with. */
export function CompanyFields({
  groups,
  main = false,
  values,
}: {
  groups: { id: string; name: string; percent: number; active: boolean }[];
  main?: boolean;
  values?: { name: string; organisationNumber: string; tierId: string | null; employeeSharePercent: number; maxMembers: number; active: boolean };
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Company name
        <input name="name" required maxLength={120} defaultValue={values?.name} className={control} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Organisation number
        <input name="organisationNumber" maxLength={40} defaultValue={values?.organisationNumber} className={control} />
        <span className="font-normal text-muted">Optional. With it, the company&apos;s accounts buy as a business with the number filled in.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Customer group
        <select name="tierId" defaultValue={values?.tierId ?? ""} className={control}>
          <option value="">No group: no discount</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.percent} %){group.active ? "" : ", switched off"}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Employees get, percent of the discount
          <input name="employeeSharePercent" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={values?.employeeSharePercent ?? 100} className={control} />
          <span className="font-normal text-muted">100: the whole discount. 50: half of it. The main account always gets all of it.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Most accounts
          <input name="maxMembers" inputMode="numeric" pattern="[0-9]{1,4}" defaultValue={values?.maxMembers ?? 25} className={control} />
          <span className="font-normal text-muted">Main accounts and employees, invitations waiting included.</span>
        </label>
      </div>
      {main && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Main account, email
          <input type="email" name="mainAccount" className={control} />
          <span className="font-normal text-muted">Invites the company&apos;s employees. Someone with no account gets one made, and signs in with a code.</span>
        </label>
      )}
      {values && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values.active} className="size-4" />
          Switched on
        </label>
      )}
    </>
  );
}
