import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { LOCATIONS_MAX } from "@/lib/company-locations";
import { addressLine, type SavedAddressFields } from "@/lib/customer-addresses";
import type { CompanyMember } from "@/server/companies";
import type { CompanyLocation } from "@/server/company-locations";

import { deleteLocationAction, saveCompanyRulesAction, saveLocationAction, setBuyerAction } from "../location-actions";

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

function AddressFields({ prefix, legend, value, words }: { prefix: "billing" | "shipping"; legend: string; value: SavedAddressFields | null; words: ReturnType<typeof adminText<"customers">>["locations"] }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        <input name={`${prefix}.name`} defaultValue={value?.name ?? ""} placeholder={words.address.name} aria-label={`${legend}: ${words.address.name}`} className={control} />
        <input name={`${prefix}.line1`} defaultValue={value?.line1 ?? ""} placeholder={words.address.line1} aria-label={`${legend}: ${words.address.line1}`} className={control} />
        <input name={`${prefix}.line2`} defaultValue={value?.line2 ?? ""} placeholder={words.address.line2} aria-label={`${legend}: ${words.address.line2}`} className={control} />
        <input name={`${prefix}.postalCode`} defaultValue={value?.postalCode ?? ""} placeholder={words.address.postalCode} aria-label={`${legend}: ${words.address.postalCode}`} className={control} />
        <input name={`${prefix}.city`} defaultValue={value?.city ?? ""} placeholder={words.address.city} aria-label={`${legend}: ${words.address.city}`} className={control} />
        <input name={`${prefix}.country`} defaultValue={value?.country ?? ""} placeholder={words.address.country} maxLength={2} aria-label={`${legend}: ${words.address.country}`} className={`${control} uppercase`} />
      </div>
    </fieldset>
  );
}

/**
 * A company's locations and who buys at each (D321 C.2), and its buying rules: whether a PO number is required and the approval limit. Drawn on the
 * company's page; every form is a server action that asks `customers:write`.
 */
export function LocationsCard({
  lang,
  storeSlug,
  companyId,
  locations,
  members,
  rules,
}: {
  lang: AdminLang;
  storeSlug: string;
  companyId: string;
  locations: CompanyLocation[];
  members: CompanyMember[];
  rules: { poRequired: boolean; limit: string; currency: string };
}) {
  const words = adminText(lang, "customers").locations;
  const employees = members.filter((m) => m.role === "employee");
  return (
    <>
      <Card title={words.rulesTitle} description={words.rulesIntro} className="flex flex-col gap-3">
        <ActionForm action={saveCompanyRulesAction.bind(null, storeSlug, companyId)} className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="poRequired" defaultChecked={rules.poRequired} className="size-4" />
            {words.poRequired}
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {fillWords(words.limit, { currency: rules.currency })}
            <input name="limit" defaultValue={rules.limit} inputMode="decimal" maxLength={20} className={`${control} w-40 tabular-nums`} />
            <span className="font-normal text-muted">{words.limitHint}</span>
          </label>
          <div>
            <SubmitButton variant="secondary">{words.saveRules}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card title={fillWords(words.title, { n: locations.length, max: LOCATIONS_MAX })} description={words.intro} className="flex flex-col gap-4">
        {locations.length === 0 && <p className="text-sm text-muted">{words.none}</p>}
        {locations.map((location) => {
          const assigned = new Set(location.buyers.map((b) => b.customerId));
          const free = employees.filter((e) => !assigned.has(e.id));
          return (
            <section key={location.id} aria-label={location.name} className="flex flex-col gap-3 rounded-panel border border-line p-4">
              <details>
                <summary className="cursor-pointer">
                  <span className="text-body-strong text-ink">{location.name}</span>
                  {location.shipping && <span className="block text-sm text-muted">{addressLine(location.shipping)}</span>}
                </summary>
                <ActionForm action={saveLocationAction.bind(null, storeSlug, companyId, location.id)} className="mt-3 flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium">
                    {words.name}
                    <input name="name" required maxLength={80} defaultValue={location.name} className={control} />
                  </label>
                  <AddressFields prefix="shipping" legend={words.shipping} value={location.shipping} words={words} />
                  <AddressFields prefix="billing" legend={words.billing} value={location.billing} words={words} />
                  <div className="flex flex-wrap gap-2">
                    <SubmitButton variant="secondary">{words.save}</SubmitButton>
                  </div>
                </ActionForm>
                <ActionForm action={deleteLocationAction.bind(null, storeSlug, companyId, location.id)} className="mt-2">
                  <SubmitButton variant="secondary">{words.delete}</SubmitButton>
                </ActionForm>
              </details>
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">{words.buyers}</h3>
                <p className="text-sm text-muted">{words.mainApproves}</p>
                {location.buyers.length > 0 && (
                  <ul className="divide-y divide-line text-sm">
                    {location.buyers.map((buyer) => (
                      <li key={buyer.customerId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span>
                          {buyer.name || buyer.email} <span className="text-muted">· {words.roles[buyer.role]}</span>
                        </span>
                        <ActionForm action={setBuyerAction.bind(null, storeSlug, companyId, location.id, buyer.customerId)} className="flex items-center gap-2">
                          <input type="hidden" name="role" value="" />
                          <SubmitButton variant="secondary">
                            {words.remove}
                            <span className="sr-only"> {buyer.email}</span>
                          </SubmitButton>
                        </ActionForm>
                      </li>
                    ))}
                  </ul>
                )}
                {free.length > 0 && (
                  <ActionForm action={setBuyerAction.bind(null, storeSlug, companyId, location.id, null)} className="flex flex-wrap items-end gap-2">
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      {words.member}
                      <select name="customerId" className={control}>
                        {free.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name || e.email}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm font-medium">
                      {words.role}
                      <select name="role" className={control} defaultValue="orderer">
                        <option value="orderer">{words.roles.orderer}</option>
                        <option value="approver">{words.roles.approver}</option>
                      </select>
                    </label>
                    <SubmitButton variant="secondary">{words.addBuyer}</SubmitButton>
                  </ActionForm>
                )}
              </div>
            </section>
          );
        })}
        {locations.length < LOCATIONS_MAX && (
          <details className="rounded-panel border border-line p-4">
            <summary className="cursor-pointer text-body-strong text-ink">{words.add}</summary>
            <ActionForm action={saveLocationAction.bind(null, storeSlug, companyId, null)} className="mt-3 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {words.name}
                <input name="name" required maxLength={80} placeholder={words.namePlaceholder} className={control} />
              </label>
              <AddressFields prefix="shipping" legend={words.shipping} value={null} words={words} />
              <AddressFields prefix="billing" legend={words.billing} value={null} words={words} />
              <div>
                <SubmitButton>{words.add}</SubmitButton>
              </div>
            </ActionForm>
          </details>
        )}
      </Card>
    </>
  );
}
