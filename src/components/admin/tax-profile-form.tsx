"use client";

import { useState } from "react";

import type { FormState } from "@/components/admin/action-form";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { OSS_SCHEMES, formOf, type OssScheme, type ReadinessLine, type TaxProfile } from "@/lib/tax-profile";
import { EU_COUNTRIES } from "@/lib/vat-number";

import { useAdminLang, useAdminText } from "./admin-text";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm disabled:opacity-60";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

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

const regionName = (code: string, locale: string): string => {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
};

/** EU countries by their name in the admin's language. */
const euByName = (locale: string) =>
  [...EU_COUNTRIES].map((code) => ({ code, name: regionName(code, locale) })).sort((a, b) => a.name.localeCompare(b.name, locale));

const when = (iso: string, locale: string) => new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

/** The admin's locale, for names, dates and numbers in the browser. */
const useLocale = () => ADMIN_LANG_FACTS[useAdminLang()].locale;

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
  const all = useAdminText("tax");
  const w = all.form;
  const locale = useLocale();
  const EU_BY_NAME = euByName(locale);
  const start = formOf(profile);
  const [scheme, setScheme] = useState<OssScheme>(start.ossScheme);
  const markets = new Set(start.iossMarkets);
  return (
    <ActionForm action={saveAction} successMessage={w.saved} className="flex flex-col gap-6">
      <fieldset disabled={!canEdit} className="contents">
        <section aria-labelledby="vat" className={card}>
          <h2 id="vat" className="text-title text-ink">
            {w.vatTitle}
          </h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="vatRegistered" defaultChecked={start.vatRegistered} className="mt-0.5 size-4" />
            <span>
              {w.registered}
              <span className={`block ${hint}`}>{w.registeredHint}</span>
            </span>
          </label>
          <label className={label}>
            {w.vatNumber}{" "}
            <span className={hint}>
              {country === "NO" ? w.vatNumberNo : country ? fillWords(w.vatNumberStarts, { prefix: country === "GR" ? "EL" : country }) : w.vatNumberAny}
            </span>
            <input name="vatNumber" defaultValue={start.vatNumber} autoComplete="off" spellCheck={false} className={`${input} font-mono uppercase sm:max-w-sm`} />
            <span className={hint}>{fillWords(w.vatNumberHint, { country: countryName ?? w.ownCountry })}</span>
          </label>
          <label className={label}>
            {w.dispatch} <span className={hint}>{w.dispatchShape}</span>
            <input
              name="dispatchCountry"
              defaultValue={start.dispatchCountry}
              placeholder={country ?? ""}
              maxLength={2}
              autoComplete="off"
              className={`${input} uppercase sm:w-24`}
            />
            <span className={hint}>{fillWords(w.dispatchHint, { country: countryName ?? w.storeCountry })}</span>
          </label>
        </section>

        <section aria-labelledby="oss" className={card}>
          <h2 id="oss" className="text-title text-ink">
            {w.ossTitle}
          </h2>
          <p className="text-sm text-muted">{w.ossIntro}</p>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">{w.scheme}</legend>
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
                  {all.schemes[option].label}
                  <span className={`block ${hint}`}>{all.schemes[option].hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {scheme !== "none" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className={label}>
                {w.memberState}
                <select name="ossMemberState" defaultValue={start.ossMemberState} className={input}>
                  <option value="">{w.choose}</option>
                  {EU_BY_NAME.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              {scheme === "non_union" && (
                <label className={label}>
                  {w.ossNumber} <span className={hint}>{w.ossNumberShape}</span>
                  <input name="ossNumber" defaultValue={start.ossNumber} autoComplete="off" spellCheck={false} className={`${input} font-mono uppercase`} />
                </label>
              )}
              <label className={label}>
                {w.registeredOn} <span className={hint}>{w.dateShape}</span>
                <input name="ossRegisteredOn" type="date" defaultValue={start.ossRegisteredOn} className={input} />
              </label>
            </div>
          )}
        </section>

        <section aria-labelledby="ioss" className={card}>
          <h2 id="ioss" className="text-title text-ink">
            {w.iossTitle}
          </h2>
          <p className="text-sm text-muted">{w.iossIntro}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              {w.iossNumber} <span className={hint}>{w.iossNumberShape}</span>
              <input name="iossNumber" defaultValue={start.iossNumber} autoComplete="off" spellCheck={false} className={`${input} font-mono uppercase`} />
            </label>
            <label className={label}>
              {w.intermediary}
              <input name="iossIntermediary" defaultValue={start.iossIntermediary} maxLength={120} autoComplete="off" className={input} />
            </label>
            <label className={label}>
              {w.registeredOn} <span className={hint}>{w.dateShape}</span>
              <input name="iossRegisteredOn" type="date" defaultValue={start.iossRegisteredOn} className={input} />
            </label>
          </div>
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">{w.iossMarkets}</legend>
            <p className={hint}>{w.iossMarketsHint}</p>
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
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      ) : (
        <p role="note" className="text-sm text-muted">
          {w.ownerOnly}
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
  const w = useAdminText("tax").check;
  const locale = useLocale();
  const source = check?.source === "brreg" ? w.brreg : w.vies;
  const at = check ? when(check.checkedAt, locale) : "";
  return (
    <section aria-labelledby="check" className={card}>
      <h2 id="check" className="text-title text-ink">
        {w.title}
      </h2>
      {number === null ? (
        <p className="text-sm text-muted">{w.saveFirst}</p>
      ) : (
        <>
          <p className="text-sm">
            <span className="font-mono">{number}</span>{" "}
            {check === null ? (
              <span className="text-muted">{w.notChecked}</span>
            ) : check.status === "valid" ? (
              <span>
                <strong>{w.valid}</strong> <span className="text-muted">{fillWords(w.validWhen, { source, when: at })}</span>
              </span>
            ) : check.status === "invalid" ? (
              <span>
                <strong>{w.invalid}</strong> <span className="text-muted">{fillWords(w.invalidWhen, { source, when: at })}</span>
              </span>
            ) : (
              <span>
                <strong>{w.unavailable}</strong> <span className="text-muted">{fillWords(w.unavailableWhen, { source, when: at })}</span>
              </span>
            )}
          </p>
          {check?.status === "valid" && (check.name || check.address || check.requestIdentifier) && (
            <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
              {check.name && (
                <>
                  <dt className="text-muted">{w.name}</dt>
                  <dd>{check.name}</dd>
                </>
              )}
              {check.address && (
                <>
                  <dt className="text-muted">{w.address}</dt>
                  <dd className="whitespace-pre-line">{check.address}</dd>
                </>
              )}
              {check.requestIdentifier && (
                <>
                  <dt className="text-muted">{w.consultation}</dt>
                  <dd className="font-mono">{check.requestIdentifier}</dd>
                </>
              )}
            </dl>
          )}
        </>
      )}
      {canEdit && number !== null && (
        <ActionForm action={action} successMessage={w.checked} className="flex flex-col gap-3">
          <div>
            <SubmitButton variant="secondary">{w.checkNow}</SubmitButton>
          </div>
        </ActionForm>
      )}
    </section>
  );
}

/** What is on and what is missing, one line each (`readiness()`), with the word On or Off so colour is never the only signal. */
export function ReadinessList({ lines }: { lines: ReadinessLine[] }) {
  const w = useAdminText("tax").readiness;
  return (
    <section aria-labelledby="readiness" className={card}>
      <h2 id="readiness" className="text-title text-ink">
        {w.title}
      </h2>
      <ul className="flex flex-col divide-y divide-line text-sm">
        {lines.map((line) => (
          <li key={line.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
            <span className={`rounded-full border border-line px-2 py-0.5 text-xs font-medium ${line.on ? "bg-sunken" : "text-muted"}`}>{line.on ? w.on : w.off}</span>
            <span className="min-w-0 flex-1">{line.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The warnings for an accountant's eyes. Needs review: legal-adjacent. */
export function TaxWarnings({ warnings }: { warnings?: readonly string[] }) {
  const w = useAdminText("tax").warnings;
  return (
    <section aria-labelledby="warnings" className={card}>
      <h2 id="warnings" className="text-title text-ink">
        {w.title}
      </h2>
      <p className="text-sm text-muted">{w.intro}</p>
      <ul className="flex list-disc flex-col gap-2 pl-5 text-sm">
        {(warnings ?? w.items).map((warning) => (
          <li key={warning}>{warning}</li>
        ))}
      </ul>
    </section>
  );
}
