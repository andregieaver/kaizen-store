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

/** A catalogue text with a language's name in it. */
const named = (text: string, name: string) => text.replaceAll("{name}", name);

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
  words,
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
  /** The page's words in the admin's language (D312: what is converted). */
  words: DomainsMessages;
  actions: { add: Action; check: Action; primary: Action; remove: Action; language: Action };
}) {
  const primary = domains.find((d) => d.isPrimary);
  const nameOf = (lang: string) => languages.find((l) => l.lang === lang)?.name ?? lang;
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="address-heading" className={card}>
        <h2 id="address-heading" className="text-title text-ink">
          Your store&apos;s address
        </h2>
        <p className="text-sm">
          <a href={address} className="font-medium underline" target="_blank" rel="noopener">
            {address.replace(/^https?:\/\//, "")}
          </a>
          {address !== hostAddress && (
            <span className="text-muted">
              {" "}
              · {hostAddress.replace(/^https?:\/\//, "")} leads there too
            </span>
          )}
        </p>
        {deploying && (
          <p role="status" className="rounded-md border border-line bg-sunken p-3 text-sm">
            Your domains changed. Kaizena Flow is putting the change live, which takes a few minutes; this page updates by
            itself.
            <RefreshWhile seconds={20} />
          </p>
        )}
        {owner && primary && (
          <DomainButton action={actions.primary} id="" label={`Use ${hostAddress.replace(/^https?:\/\//, "")} as the address instead`} />
        )}
      </section>

      <section aria-labelledby="domains-heading" className={card}>
        <div>
          <h2 id="domains-heading" className="text-title text-ink">
            Your own domains
          </h2>
          <p className="text-sm text-muted">
            Use a domain you own, like butikk.example.no or example.no. Add it here, then create the DNS records shown at
            the company where you manage the domain&apos;s DNS. When they are in place, the domain becomes your
            store&apos;s address, with a certificate for https, and your other addresses lead there. Up to {MAX_DOMAINS}{" "}
            domains.
          </p>
        </div>
        {!configured ? (
          <p className="text-sm">Custom domains are not set up on Kaizena Flow yet.</p>
        ) : owner ? (
          <ActionForm action={actions.add} className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="flex flex-1 flex-col gap-1 text-sm font-medium">
              Domain
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
            <SubmitButton>Add domain</SubmitButton>
          </ActionForm>
        ) : (
          <p className="text-sm text-muted">Only an owner can add domains.</p>
        )}

        {domains.length > 0 && (
          <ul className="flex flex-col divide-y divide-line">
            {domains.map((domain) => (
              <li key={domain.id} className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{domain.hostname}</span>
                  <span className="rounded-full border border-line px-2 py-0.5 text-xs">
                    {domain.isPrimary
                      ? "Your address"
                      : domain.status === "active"
                        ? domain.language
                          ? named(words.activeInLanguage, nameOf(domain.language))
                          : "Active: leads to your address"
                        : "Waiting for DNS"}
                  </span>
                  {domain.language && domain.status === "pending" && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs">{named(words.forLanguage, nameOf(domain.language))}</span>
                  )}
                </div>
                {domain.status === "pending" && (
                  <>
                    <p className="text-sm text-muted">
                      Create these records at your DNS provider, and remove other A, AAAA or CNAME records on the same
                      name. Providers that add the domain themselves want only the first part of the name
                      {domain.checks.apexName ? (
                        <>
                          , like <span className="font-mono">{relativeName(`_kaizen.${domain.hostname}`, domain.checks.apexName)}</span>
                        </>
                      ) : null}
                      .
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-line text-muted">
                            <th className="py-2 pr-3 font-normal">Type</th>
                            <th className="py-2 pr-3 font-normal">Name</th>
                            <th className="py-2 pr-3 font-normal">Value</th>
                            <th className="py-2 font-normal">Found</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dnsRecords(domain.hostname, domain.token, domain.checks).map((record) => (
                            <tr key={`${record.type}-${record.name}-${record.value}`} className="border-b border-line align-top">
                              <td className="py-2 pr-3 font-mono">{record.type}</td>
                              <td className="py-2 pr-3 font-mono break-all">{record.name}</td>
                              <td className="py-2 pr-3 font-mono break-all">{record.value}</td>
                              <td className="py-2" title={record.why}>
                                {record.done ? "Yes" : "Not yet"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {domain.checks.problem && <p className="text-sm text-danger-text">{domain.checks.problem}</p>}
                    <p className="text-xs text-muted">
                      {domain.checkedAt
                        ? `Last checked ${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" }).format(new Date(domain.checkedAt))}. `
                        : ""}
                      Checked again each time you open this page; DNS changes can take up to a few hours to show.
                    </p>
                  </>
                )}
                <div className="flex flex-wrap gap-2">
                  {domain.status === "pending" && <DomainButton action={actions.check} id={domain.id} label="Check now" />}
                  {owner && domain.status === "active" && !domain.isPrimary && (
                    <DomainButton action={actions.primary} id={domain.id} label="Make this the address" />
                  )}
                  {owner && <DomainButton action={actions.remove} id={domain.id} label="Remove" />}
                </div>
                {owner && !domain.isPrimary && (languages.length > 0 || domain.language) && (
                  <LanguageChoice action={actions.language} domain={domain} languages={languages} nameOf={nameOf} words={words} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
