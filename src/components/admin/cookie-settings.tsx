import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { toolCategories, type TrackingSettings } from "@/lib/cookie-consent";
import { CODE_MAX_LENGTH, CODE_PLACES, codeCategories, type CustomCode } from "@/lib/custom-code";
import { fillWords } from "@/lib/admin-fill";
import { legalEn, type LegalMessages } from "@/lib/admin-messages/legal.en";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 font-mono text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

/** Categories as they read inside a sentence, joined with the language's "and". */
const categoryList = (categories: readonly ("preferences" | "statistics" | "marketing")[], words: LegalMessages) =>
  categories.map((c) => words.cookies.categoriesLower[c]).join(words.cookies.and);

/**
 * A site's analytics and marketing tools (D58), Kaizen's or a store's: each
 * by the id its service gives, loaded only after a visitor allows its
 * category, with a summary of what visitors are asked.
 */
export function TrackingForm({
  tracking,
  action,
  cookiePage,
  words = legalEn,
  ads = false,
}: {
  tracking: TrackingSettings;
  /** A store's form also offers the ads tags (D303 I1); Kaizena Flow's own site has none. */
  ads?: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  cookiePage: string;
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: LegalMessages;
}) {
  const w = words.cookies.tools;
  const asked = toolCategories(tracking);
  return (
    <section aria-labelledby="tools-heading" className={card}>
      <div>
        <h2 id="tools-heading" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">{w.text}</p>
      </div>
      <ActionForm action={action} className="flex flex-col gap-4" successMessage={w.saved}>
        <label className={label}>
          Google Analytics 4
          <input name="ga4" defaultValue={tracking.ga4 ?? ""} placeholder="G-XXXXXXXXXX" className={input} />
          <span className={hint}>{w.ga4Hint}</span>
        </label>
        <label className={label}>
          Google Tag Manager
          <input name="gtm" defaultValue={tracking.gtm ?? ""} placeholder="GTM-XXXXXXX" className={input} />
          <span className={hint}>{w.gtmHint}</span>
        </label>
        <label className={label}>
          Meta Pixel
          <input name="metaPixel" defaultValue={tracking.metaPixel ?? ""} placeholder="1234567890" inputMode="numeric" className={input} />
          <span className={hint}>{w.metaHint}</span>
        </label>
        {ads && (
          <>
            <label className={label}>
              {w.names.googleAds}
              <input name="googleAds" defaultValue={tracking.googleAds ?? ""} placeholder={w.googleAdsPlaceholder} className={input} />
              <span className={hint}>{w.googleAdsHint}</span>
            </label>
            <label className={label}>
              {w.names.tiktokPixel}
              <input name="tiktokPixel" defaultValue={tracking.tiktokPixel ?? ""} placeholder={w.tiktokPlaceholder} className={input} />
              <span className={hint}>{w.tiktokHint}</span>
            </label>
            <label className={label}>
              {w.names.pinterestTag}
              <input name="pinterestTag" defaultValue={tracking.pinterestTag ?? ""} placeholder="2612345678901" inputMode="numeric" className={input} />
              <span className={hint}>{w.pinterestHint}</span>
            </label>
            <p className={hint}>{w.events}</p>
          </>
        )}
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
      <p className="text-sm">
        {asked.length === 0
          ? w.noneAsked
          : fillWords(w.asked, { categories: categoryList(asked, words) })}{" "}
        <Link href={cookiePage} className="underline" target="_blank" rel="noopener">
          {w.seePage}
        </Link>
      </p>
    </section>
  );
}

const CODE_CATEGORIES = ["necessary", "preferences", "statistics", "marketing"] as const;

/**
 * A store's own code (D61) for its pages' head and the start and end of
 * their body, each with the cookie category it falls under. Only added on
 * the store's own address (`live`).
 */
export function CustomCodeForm({
  code,
  live,
  action,
  words = legalEn,
}: {
  code: CustomCode;
  /** Whether the store is on its own address, where the code is added (P7). */
  live: boolean;
  action: (state: FormState, form: FormData) => Promise<FormState>;
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: LegalMessages;
}) {
  const w = words.cookies.code;
  const asked = codeCategories(code);
  return (
    <section aria-labelledby="code-heading" className={card}>
      <div>
        <h2 id="code-heading" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">{w.text}</p>
      </div>
      {!live && (
        <p role="status" className="rounded-md border border-line bg-sunken p-3 text-sm">
          {w.notLive}
        </p>
      )}
      <ActionForm action={action} className="flex flex-col gap-5" successMessage={w.saved}>
        {CODE_PLACES.map((place) => (
          <fieldset key={place} className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{w.places[place].title}</legend>
            <label className={label}>
              <span className="sr-only">{fillWords(w.codeFor, { place: w.places[place].title.toLowerCase() })}</span>
              <textarea
                name={`${place}.code`}
                defaultValue={code[place]?.code ?? ""}
                rows={5}
                maxLength={CODE_MAX_LENGTH}
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                className={`${input} py-2`}
              />
              <span className={hint}>{w.places[place].hint}{w.emptyNone}</span>
            </label>
            <label className={label}>
              {w.what}
              <select name={`${place}.category`} defaultValue={code[place]?.category ?? "marketing"} className={input.replace("font-mono ", "")}>
                {CODE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {w.choices[value]}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        ))}
        <div>
          <SubmitButton>{w.save}</SubmitButton>
        </div>
      </ActionForm>
      {asked.length > 0 && (
        <p className="text-sm">
          {fillWords(w.asked, { categories: categoryList(asked, words) })}
        </p>
      )}
    </section>
  );
}

/** The latest proofs of consent (D58): when, what was asked and what was allowed. */
export function ConsentLog({
  consents,
  words = legalEn,
  locale = "en-GB",
}: {
  consents: { id: string; visitor: string; choices: Record<string, boolean>; version: string; createdAt: string }[];
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: LegalMessages;
  /** How dates are written; en-GB unless given. */
  locale?: string;
}) {
  const w = words.cookies.consents;
  const lower: Record<string, string> = words.cookies.categoriesLower;
  /** A category id as it reads in the list; one not known (an older version's) as written. */
  const categoryWord = (id: string) => lower[id] ?? id;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  return (
    <section aria-labelledby="consents-heading" className={card}>
      <div>
        <h2 id="consents-heading" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">{w.text}</p>
      </div>
      {consents.length === 0 ? (
        <p className="text-sm text-muted">{w.none}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 pr-4 font-normal">{w.when}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{w.visitor}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{w.askedAbout}</th>
                <th scope="col" className="py-2 font-normal">{w.allowed}</th>
              </tr>
            </thead>
            <tbody>
              {consents.map((consent) => {
                const allowed = Object.entries(consent.choices).filter(([, on]) => on).map(([c]) => c);
                return (
                  <tr key={consent.id} className="border-b border-line last:border-0">
                    <td className="py-2 pr-4 whitespace-nowrap">{date.format(new Date(consent.createdAt))}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{consent.visitor.slice(0, 8)}</td>
                    <td className="py-2 pr-4">{consent.version.split("+").filter(Boolean).map(categoryWord).join(", ") || w.nothing}</td>
                    <td className="py-2">{allowed.length > 0 ? allowed.map(categoryWord).join(", ") : w.onlyNecessary}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
