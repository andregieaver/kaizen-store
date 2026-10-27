import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import { dnsRecords, MAX_DOMAINS } from "@/lib/custom-domains";
import type { StoreDomain } from "@/server/domains";

import { RefreshWhile } from "./refresh-while";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/** One small form with a hidden id: a button that acts on one domain. */
function DomainButton({ action, id, label }: { action: Action; id: string; label: string }) {
  return (
    <ActionForm action={action} className="flex flex-col gap-1">
      <input type="hidden" name="id" value={id} />
      <SubmitButton variant="secondary">{label}</SubmitButton>
    </ActionForm>
  );
}

/**
 * Which language a domain is for (D313): every language by default, which leads to the store's address; one of the store's other
 * languages makes the domain that language's own address, with the language left out of its addresses.
 */
function LanguageChoice({
  action,
  domain,
  languages,
  nameOf,
  words,
}: {
  action: Action;
  domain: StoreDomain;
  languages: { lang: string; name: string }[];
  nameOf: (lang: string) => string;
  words: DomainsMessages;
}) {
  const options = domain.language && !languages.some((l) => l.lang === domain.language) ? [...languages, { lang: domain.language, name: nameOf(domain.language) }] : languages;
  return (
    <details className="text-sm" open={domain.language !== null}>
      <summary className="cursor-pointer text-muted">{words.forOneLanguage}</summary>
      <ActionForm action={action} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="id" value={domain.id} />
        <label className="flex flex-1 flex-col gap-1 font-medium">
          {words.language}
          <select name="language" defaultValue={domain.language ?? ""} className={input}>
            <option value="">{words.everyLanguage}</option>
            {options.map((l) => (
              <option key={l.lang} value={l.lang}>
                {named(words.languageOption, l.name)}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant="secondary">{words.save}</SubmitButton>
      </ActionForm>
      <p className="mt-2 text-xs text-muted">{words.explain}</p>
    </details>
  );
}

/**
 * Which country a domain is for (D338): every country by default, which leads to the store's address; one of the store's other countries makes
 * the domain that country's own address, with the country left out of its addresses.
 */
function CountryChoice({
  action,
  domain,
  countries,
  nameOf,
  words,
}: {
  action: Action;
  domain: StoreDomain;
  countries: { code: string; name: string }[];
  nameOf: (code: string) => string;
  words: DomainsMessages;
}) {
  const options = domain.market && !countries.some((c) => c.code === domain.market) ? [...countries, { code: domain.market, name: nameOf(domain.market) }] : countries;
  return (
    <details className="text-sm" open={domain.market !== null}>
      <summary className="cursor-pointer text-muted">{words.forOneCountry}</summary>
      <ActionForm action={action} className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
        <input type="hidden" name="id" value={domain.id} />
        <label className="flex flex-1 flex-col gap-1 font-medium">
          {words.country}
          <select name="market" defaultValue={domain.market ?? ""} className={input}>
            <option value="">{words.everyCountry}</option>
            {options.map((c) => (
              <option key={c.code} value={c.code}>
                {named(words.countryOption, c.name)}
              </option>
            ))}
          </select>
        </label>
        <SubmitButton variant="secondary">{words.save}</SubmitButton>
      </ActionForm>
      <p className="mt-2 text-xs text-muted">{words.explainCountry}</p>
    </details>
  );
}

/** A catalogue text with a language's name in it. */
const named = (text: string, value: string, key = "name") => text.replaceAll(`{${key}}`, value);

/** A record's name as providers that add the domain themselves want it: `_kaizen.butikk` for `_kaizen.butikk.example.no`. */
const relativeName = (name: string, apex: string | undefined) =>
  apex && name.endsWith(`.${apex}`) ? name.slice(0, -apex.length - 1) : apex === name ? "@" : name;

/**
 * A store's addresses (P8): where it lives now, its own domains with the DNS
 * records each needs, and which one is its address.
 */
export function DomainsPanel({
  address,
  hostAddress,
  domains,
  deploying,
  owner,
  configured,
  languages,
  countries = [],
  words,
  locale = "en-GB",
  actions,
}: {
  /** The store's address in this deployment. */
  address: string;
  /** Its `{store}.{domain}` address, which always leads to it. */
  hostAddress: string;
  domains: StoreDomain[];
  /** The domains changed and a deployment with them is on its way. */
  deploying: boolean;
  owner: boolean;
  /** Kaizen's Vercel settings are there, so domains can be added. */
  configured: boolean;
  /** The languages a domain may be the address of (D313, `domainLanguages()`); none for a store in one language. */
  languages: { lang: string; name: string }[];
  /** The countries a domain may be the address of (D338, `domainCountries()`); none for a store in one country. */
  countries?: { code: string; name: string }[];
  /** The page's words in the admin's language (D312: what is converted). */
  words: DomainsMessages;
  /** The admin's date format (D312 A11). */
  locale?: string;
  actions: { add: Action; check: Action; primary: Action; remove: Action; language: Action; country?: Action };
}) {
  const primary = domains.find((d) => d.isPrimary);
  const nameOf = (lang: string) => languages.find((l) => l.lang === lang)?.name ?? lang;
  const countryName = (code: string) => countries.find((c) => c.code === code)?.name ?? code;
  // A store gives domains to its countries or to its languages, never both (D338): once one kind is chosen, only it is offered.
  const byCountry = domains.some((d) => d.market !== null);
  const byLanguage = domains.some((d) => d.language !== null);
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="address-heading" className={card}>
        <h2 id="address-heading" className="text-title text-ink">
          {words.address}
        </h2>
        <p className="text-sm">
          <a href={address} className="font-medium underline" target="_blank" rel="noopener">
            {address.replace(/^https?:\/\//, "")}
          </a>
          {address !== hostAddress && (
            <span className="text-muted">
              {" "}
              · {named(words.leadsThere, hostAddress.replace(/^https?:\/\//, ""), "host")}
            </span>
          )}
        </p>
        {deploying && (
          <p role="status" className="rounded-md border border-line bg-sunken p-3 text-sm">
            {words.deploying}
            <RefreshWhile seconds={20} />
          </p>
        )}
        {owner && primary && (
          <DomainButton action={actions.primary} id="" label={named(words.useHost, hostAddress.replace(/^https?:\/\//, ""), "host")} />
        )}
      </section>

      <section aria-labelledby="domains-heading" className={card}>
        <div>
          <h2 id="domains-heading" className="text-title text-ink">
            {words.ownDomains}
          </h2>
          <p className="text-sm text-muted">
            {named(words.ownDomainsNote, String(MAX_DOMAINS), "max")}
          </p>
        </div>
        {!configured ? (
          <p className="text-sm">{words.notConfigured}</p>
        ) : owner ? (
          <ActionForm action={actions.add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
              {words.domain}
              <input
                name="hostname"
                required
                placeholder="butikk.example.no"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                className={input}
              />
            </label>
            <SubmitButton>{words.add}</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">{words.ownerOnly}</p>
        )}

        {domains.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {domains.map((domain) => (
              <li key={domain.id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{domain.hostname}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs">
                    {domain.isPrimary
                      ? words.yourAddress
                      : domain.status === "active"
                        ? domain.language
                          ? named(words.activeInLanguage, nameOf(domain.language))
                          : domain.market
                            ? named(words.activeInCountry, countryName(domain.market))
                            : words.activeLeads
                        : words.waitingDns}
                  </span>
                  {domain.language && domain.status === "pending" && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs">{named(words.forLanguage, nameOf(domain.language))}</span>
                  )}
                  {domain.market && domain.status === "pending" && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs">{named(words.forCountry, countryName(domain.market))}</span>
                  )}
                </div>
                {domain.status === "pending" && (
                  <>
                    <p className="text-sm text-muted">
                      {words.createRecords}
                      {domain.checks.apexName ? (
                        <>
                          {words.like}<span className="font-mono">{relativeName(`_kaizen.${domain.hostname}`, domain.checks.apexName)}</span>
                        </>
                      ) : null}
                      .
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-line text-muted">
                            <th className="py-2 pr-3 font-normal">{words.type}</th>
                            <th className="py-2 pr-3 font-normal">{words.name}</th>
                            <th className="py-2 pr-3 font-normal">{words.value}</th>
                            <th className="py-2 font-normal">{words.found}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dnsRecords(domain.hostname, domain.token, domain.checks).map((record) => (
                            <tr key={`${record.type}-${record.name}-${record.value}`} className="border-b border-line align-top">
                              <td className="py-2 pr-3 font-mono">{record.type}</td>
                              <td className="py-2 pr-3 font-mono break-all">{record.name}</td>
                              <td className="py-2 pr-3 font-mono break-all">{record.value}</td>
                              <td className="py-2" title={record.why}>
                                {record.done ? words.yes : words.notYet}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {domain.checks.problem && <p className="text-sm text-danger-text">{domain.checks.problem}</p>}
                    <p className="text-xs text-muted">
                      {domain.checkedAt
                        ? named(words.lastChecked, new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(domain.checkedAt)), "date")
                        : ""}
                      {words.checkedAgain}
                    </p>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  {domain.status === "pending" && <DomainButton action={actions.check} id={domain.id} label={words.checkNow} />}
                  {owner && domain.status === "active" && !domain.isPrimary && (
                    <DomainButton action={actions.primary} id={domain.id} label={words.makeAddress} />
                  )}
                  {owner && <DomainButton action={actions.remove} id={domain.id} label={words.remove} />}
                </div>
                {owner && !domain.isPrimary && !byCountry && (languages.length > 0 || domain.language) && (
                  <LanguageChoice action={actions.language} domain={domain} languages={languages} nameOf={nameOf} words={words} />
                )}
                {owner && !domain.isPrimary && !byLanguage && actions.country && (countries.length > 0 || domain.market) && (
                  <CountryChoice action={actions.country} domain={domain} countries={countries} nameOf={countryName} words={words} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
