"use client";

import { useState } from "react";

import { customersEn, type CustomersMessages } from "@/lib/admin-messages/customers.en";
import type { BrregCompany } from "@/lib/brreg";
import type { BrregLookup as Lookup, BrregSearch as Search } from "@/server/brreg";

import { BrregLookup, RegisterNote } from "./brreg-lookup";

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The fields a company is made and edited with. With `lookup` and `search` (the store's actions for asking
 * Brønnøysundregistrene, D124) a Norwegian company can be found by number or name to fill in its name and
 * organisation number; a name already typed is kept, and both fields stay editable.
 */
export function CompanyFields({
  groups,
  main = false,
  values,
  lookup,
  search,
  words = customersEn.fields,
}: {
  groups: { id: string; name: string; percent: number; active: boolean }[];
  main?: boolean;
  values?: { name: string; organisationNumber: string; tierId: string | null; employeeSharePercent: number; maxMembers: number; active: boolean };
  lookup?: (input: string) => Promise<Lookup>;
  search?: (input: string) => Promise<Search>;
  /** The form's words in the admin's language (D312 A6); English when not given. */
  words?: CustomersMessages["fields"];
}) {
  const [name, setName] = useState(values?.name ?? "");
  const [organisationNumber, setOrganisationNumber] = useState(values?.organisationNumber ?? "");
  const [fromRegister, setFromRegister] = useState<BrregCompany | null>(null);
  const fill = (company: BrregCompany) => {
    if (name.trim() === "") setName(company.name);
    // Digits only: the number is what the company's accounts are filled in with at checkout.
    setOrganisationNumber(company.organisationNumber);
    setFromRegister(company);
  };

  return (
    <>
      {lookup && search && (
        <div className="flex flex-col gap-2">
          <BrregLookup lookup={lookup} search={search} onPick={fill} />
          {fromRegister && <RegisterNote company={fromRegister} fills="company" />}
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium">
        {words.name}
        <input
          name="name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={control}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {words.organisationNumber}
        <input
          name="organisationNumber"
          maxLength={40}
          value={organisationNumber}
          onChange={(event) => setOrganisationNumber(event.target.value)}
          className={control}
        />
        <span className="font-normal text-muted">{words.organisationHint}</span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {words.group}
        <select name="tierId" defaultValue={values?.tierId ?? ""} className={control}>
          <option value="">{words.noGroup}</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.percent} %){group.active ? "" : words.switchedOffSuffix}
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.share}
          <input name="employeeSharePercent" inputMode="numeric" pattern="[0-9]{1,3}" defaultValue={values?.employeeSharePercent ?? 100} className={control} />
          <span className="font-normal text-muted">{words.shareHint}</span>
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.max}
          <input name="maxMembers" inputMode="numeric" pattern="[0-9]{1,4}" defaultValue={values?.maxMembers ?? 25} className={control} />
          <span className="font-normal text-muted">{words.maxHint}</span>
        </label>
      </div>
      {main && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          {words.main}
          <input type="email" name="mainAccount" className={control} />
          <span className="font-normal text-muted">{words.mainHint}</span>
        </label>
      )}
      {values && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={values.active} className="size-4" />
          {words.switchedOn}
        </label>
      )}
    </>
  );
}
