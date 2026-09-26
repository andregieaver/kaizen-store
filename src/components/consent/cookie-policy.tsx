import { CONSENT_CATEGORIES, type ConsentCategory, type OptionalCategory } from "@/lib/cookie-consent";
import { t } from "@/lib/i18n";

import { CookieSettingsButton } from "./consent-manager";

/** A cookie as a site's cookie page lists it (D58). */
export type ListedCookie = {
  name: string;
  /** Storage items are listed with the cookies; a missing kind is a cookie. */
  kind?: "cookie" | "localStorage" | "sessionStorage";
  provider: string;
  category: ConsentCategory;
  /** Days it lasts; null until the browser closes. */
  days: number | null;
  purpose: { en: string } & Partial<Record<string, string>>;
};

/**
 * A site's cookie page (D58): what it stores in the browser, by category,
 * who sets it, why and for how long, and (when it uses anything optional)
 * the button to change the choice. Kaizen's in English, a store's in the
 * market's language.
 */
export function CookiePolicy({
  lang,
  cookies,
  categories,
}: {
  lang: string;
  cookies: ListedCookie[];
  /** The optional categories the site uses; empty when it uses only necessary cookies. */
  categories: OptionalCategory[];
}) {
  const m = t(lang);
  const shown = CONSENT_CATEGORIES.filter(
    (c) => c === "necessary" || categories.includes(c as OptionalCategory) || cookies.some((k) => k.category === c),
  );
  const lasts = ({ kind, days }: ListedCookie) =>
    kind === "localStorage" ? m.untilCleared : days === null ? m.untilClosed : m.days(days);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{m.cookies}</h1>
        <p className="max-w-2xl">{m.cookiePageIntro}</p>
        {categories.length === 0 ? (
          <p className="max-w-2xl">{m.onlyNecessary}</p>
        ) : (
          <CookieSettingsButton
            label={m.cookieSettings}
            className="w-fit min-h-11 rounded-md bg-foreground px-4 text-sm font-medium text-background"
          />
        )}
      </div>
      {shown.map((category) => {
        const list = cookies.filter((cookie) => cookie.category === category);
        const info = m.consentCategories[category];
        return (
          <section key={category} aria-labelledby={`cookies-${category}`} className="flex flex-col gap-3">
            <h2 id={`cookies-${category}`} className="text-xl font-semibold">
              {info.name}
            </h2>
            <p className="max-w-2xl text-muted">{info.text}</p>
            {list.length === 0 ? (
              <p className="text-muted">{m.noCookiesInCategory}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted">
                      <th scope="col" className="px-4 py-2 font-normal">
                        {m.cookieName}
                      </th>
                      <th scope="col" className="px-4 py-2 font-normal">
                        {m.cookieProvider}
                      </th>
                      <th scope="col" className="px-4 py-2 font-normal">
                        {m.cookiePurpose}
                      </th>
                      <th scope="col" className="px-4 py-2 font-normal">
                        {m.cookieDuration}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((cookie) => (
                      <tr key={`${cookie.kind ?? "cookie"}|${cookie.name}`} className="border-b border-border last:border-0 align-top">
                        <td className="px-4 py-2">
                          <span className="font-mono text-xs break-all">{cookie.name}</span>
                          {cookie.kind && cookie.kind !== "cookie" && (
                            <span className="block text-xs text-muted">{m.storageKinds[cookie.kind]}</span>
                          )}
                        </td>
                        <td className="px-4 py-2">{cookie.provider}</td>
                        <td className="px-4 py-2">{cookie.purpose[lang] || cookie.purpose.en}</td>
                        <td className="px-4 py-2 whitespace-nowrap">{lasts(cookie)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
