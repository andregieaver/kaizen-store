"use client";

import { useState } from "react";

import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { OSS_SCHEME_LABELS, OSS_SCHEMES, formOf, type OssScheme, type ReadinessLine, type TaxProfile } from "@/lib/tax-profile";
import { EU_COUNTRIES } from "@/lib/vat-number";

const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm disabled:opacity-60";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";

/** The latest check of the store's own number, as the screen shows it (serialisable: no server-only types). */
export type OwnNumberCheck = {
  status: "valid" | "invalid" | "unavailable";
  source: "vies" | "brreg";
  /** ISO time. */
  checkedAt: string;
  /** VIES's consultation number: the store's proof of the check. */
  requestIdentifier: string | null;
  /** The register's own name and address for the number, for the owner to compare with the company's. */
  name: string | null;
  address: string | null;
};

const regionName = (code: string): string => {
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** EU countries by their English name. */
const EU_BY_NAME = [...EU_COUNTRIES].map((code) => ({ code, name: regionName(code) })).sort((a, b) => a.name.localeCompare(b.name));

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

/**
 * The store's tax profile (D157, `docs/wave-1a-tax.md` 2.2): VAT registration and number, where goods are sent from, the OSS
 * and IOSS registrations. Owners change it (the action checks again); everyone else sees it as it is. Plain help under every
 * field; the plain-English warnings are written for an accountant's eyes and need review. The Check now button is its own
 * form: it checks the number as saved.
 */
export function TaxProfileForm({
  profile,
  country,
  countryName,
  canEdit,
  saveAction,
}: {
  profile: TaxProfile;
  /** The store's country (`stores.country`), or null. */
  country: string | null;
  countryName: string | null;
  canEdit: boolean;
  saveAction: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const start = formOf(profile);
  const [scheme, setScheme] = useState<OssScheme>(start.ossScheme);
  const markets = new Set(start.iossMarkets);
  return (
    <ActionForm action={saveAction} successMessage="Saved." className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="vat" className={card}>
          <h2 id="vat" className="font-medium">
            VAT registration
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="vatRegistered" defaultChecked={start.vatRegistered} className="mt-0.5 size-4" />
            <span>
              The store is registered for VAT
              <span className={`block ${hint}`}>Switch this on when the business has a VAT number. It is shown on the store&apos;s documents.</span>
            </span>
          </label>
          <label className={label}>
            VAT number{" "}
            <span className={hint}>
              {country === "NO" ? "(nine digits and MVA)" : country ? `(starts with ${country === "GR" ? "EL" : country})` : "(with the country code)"}
            </span>
            <input name="vatNumber" defaultValue={start.vatNumber} autoComplete="off" spellCheck={false} className={`${input} font-mono uppercase sm:max-w-sm`} />
            <span className={hint}>
              Must be a number of {countryName ?? "the store's own country"}. Saving a different number clears its check: use Check now below to check it
              again. Reverse charge stays off until the number has been checked valid.
            </span>
          </label>
          <label className={label}>
            Goods are sent from <span className={hint}>(two letters, such as NO or CN)</span>
            <input
              name="dispatchCountry"
              defaultValue={start.dispatchCountry}
              placeholder={country ?? ""}
              maxLength={2}
              autoComplete="off"
              className={`${input} uppercase sm:w-24`}
            />
            <span className={hint}>
              Leave empty to use {countryName ?? "the store's country"}. IOSS applies only to goods sent from outside the EU.
            </span>
          </label>
        </section>

        <section aria-labelledby="oss" className={card}>
          <h2 id="oss" className="font-medium">
            One Stop Shop (OSS)
          </h2>
          <p className="text-sm text-muted">
            Record the registration here. Kaizen charges the VAT of the buyer&apos;s country on every consumer sale, as OSS requires. The returns are not made here.
          </p>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Scheme</legend>
            {OSS_SCHEMES.map((option) => (
              <label key={option} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="ossScheme"
                  value={option}
                  checked={scheme === option}
                  onChange={() => setScheme(option)}
                  className="mt-0.5 size-4"
                />
                <span>
                  {OSS_SCHEME_LABELS[option].label}
                  <span className={`block ${hint}`}>{OSS_SCHEME_LABELS[option].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {scheme !== "none" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                Member state of registration
                <select name="ossMemberState" defaultValue={start.ossMemberState} className={input}>
                  <option value="">Choose …</option>
                  {EU_BY_NAME.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {scheme === "non_union" && (
                <label className={label}>
                  Non-Union OSS number <span className={hint}>(EU and nine digits)</span>
                  <input name="ossNumber" defaultValue={start.ossNumber} autoComplete="off" spellCheck={false} className={`${input} font-mono uppercase`} />
                </label>
              )}
              <label className={label}>
                Registered on <span className={hint}>(year-month-day)</span>
                <input name="ossRegisteredOn" type="date" defaultValue={start.ossRegisteredOn} className={input} />
              </label>
            </div>
          )}
        </section>

        <section aria-labelledby="ioss" className={card}>
          <h2 id="ioss" className="font-medium">
            Import One Stop Shop (IOSS)
          </h2>
          <p className="text-sm text-muted">
            For stores sending goods from outside the EU to private buyers in the EU. A consignment of at most 150 EUR is charged destination VAT at checkout and
            marked with the IOSS number on the order. Most stores outside the EU must register through an EU intermediary. Stores established in Norway can register directly.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              IOSS number <span className={hint}>(IM and ten digits)</span>
              <input name="iossNumber" defaultValue={start.iossNumber} autoComplete="off" spellCheck={false} className={`${input} font-mono uppercase`} />
            </label>
            <label className={label}>
              Intermediary
              <input name="iossIntermediary" defaultValue={start.iossIntermediary} maxLength={120} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              Registered on <span className={hint}>(year-month-day)</span>
              <input name="iossRegisteredOn" type="date" defaultValue={start.iossRegisteredOn} className={input} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">Markets IOSS applies to</legend>
            <p className={hint}>EU countries only. Orders to other markets are not marked.</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3 lg:grid-cols-4">
              {EU_BY_NAME.map((c) => (
                <label key={c.code} className="flex items-center gap-2">
                  <input type="checkbox" name="iossMarkets" value={c.code} defaultChecked={markets.has(c.code)} className="size-4" />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      </fieldset>

      {canEdit ? (
        <div>
          <SubmitButton>Save the tax settings</SubmitButton>
        </div>
      ) : (
        <p role="note" className="text-sm text-muted">
          Only an owner can change the tax settings.
        </p>
      )}
    </ActionForm>
  );
}

/**
 * Checking the store's own number (D157): VIES for an EU number, the open register for a Norwegian one. It checks the number
 * as saved, says what it found and when, and keeps the register's own name and address beside it so an owner can see that
 * they match the company. An answer that is not definite is said as such: the number is not taken as valid.
 */
export function OwnNumberCheckCard({
  number,
  check,
  canEdit,
  action,
}: {
  /** The saved number, or null. */
  number: string | null;
  check: OwnNumberCheck | null;
  canEdit: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
}) {
  const source = check?.source === "brreg" ? "the register of business enterprises (Brønnøysundregistrene)" : "VIES";
  return (
    <section aria-labelledby="check" className={card}>
      <h2 id="check" className="font-medium">
        Check the VAT number
      </h2>
      {number === null ? (
        <p className="text-sm text-muted">Save a VAT number above first. Then it can be checked.</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-mono">{number}</span>{" "}
            {check === null ? (
              <span className="text-muted">has not been checked.</span>
            ) : check.status === "valid" ? (
              <span>
                <strong>is registered</strong> <span className="text-muted">(checked in {source} on {when(check.checkedAt)}).</span>
              </span>
            ) : check.status === "invalid" ? (
              <span>
                <strong>was not accepted</strong> <span className="text-muted">by {source} on {when(check.checkedAt)}. Check the number.</span>
              </span>
            ) : (
              <span>
                <strong>could not be checked</strong>{" "}
                <span className="text-muted">on {when(check.checkedAt)}: {source} did not answer. The number is not taken as valid. Try again in a moment.</span>
              </span>
            )}
          </p>
          {check?.status === "valid" && (check.name || check.address || check.requestIdentifier) && (
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              {check.name && (
                <>
                  <dt className="text-muted">Registered name</dt>
                  <dd>{check.name}</dd>
                </>
              )}
              {check.address && (
                <>
                  <dt className="text-muted">Registered address</dt>
                  <dd className="whitespace-pre-line">{check.address}</dd>
                </>
              )}
              {check.requestIdentifier && (
                <>
                  <dt className="text-muted">Consultation number</dt>
                  <dd className="font-mono">{check.requestIdentifier}</dd>
                </>
              )}
            </dl>
          )}
        </>
      )}
      {canEdit && number !== null && (
        <ActionForm action={action} successMessage="Checked." className="flex flex-col gap-3">
          <div>
            <SubmitButton variant="secondary">Check now</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}

/** What is on and what is missing, one line each (`readiness()`), with the word On or Off so colour is never the only signal. */
export function ReadinessList({ lines }: { lines: ReadinessLine[] }) {
  return (
    <section aria-labelledby="readiness" className={card}>
      <h2 id="readiness" className="font-medium">
        What is on
      </h2>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
            <span className={`rounded-full border border-border px-2 py-0.5 text-xs font-medium ${line.on ? "bg-surface" : "text-muted"}`}>{line.on ? "On" : "Off"}</span>
            <span className="min-w-0 flex-1">{line.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The warnings for an accountant's eyes. Needs review: legal-adjacent. */
export function TaxWarnings({ warnings }: { warnings: readonly string[] }) {
  return (
    <section aria-labelledby="warnings" className={card}>
      <h2 id="warnings" className="font-medium">
        Read this with your accountant
      </h2>
      <p className="text-sm text-muted">This is how Kaizen handles VAT, and where it stops. It is not tax advice.</p>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
        {warnings.map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}
