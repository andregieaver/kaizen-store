import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { Button, ButtonLink, Card, EmptyState, Field, PageHeader, TextInput } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminDate } from "@/lib/admin-date";
import { adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { todayIn } from "@/lib/analytics-period";
import { PROSPECTS_WORDS } from "@/lib/admin-words/prospects";
import type { ProspectsMessages } from "@/lib/admin-messages/prospects.en";
import { foldDomain } from "@/lib/do-not-contact";
import { filtersFromQuery, filtersToQuery, hasFilters, industryName, placeName, RESULTS_MAX, type ProspectFilters } from "@/lib/prospect-search";
import { aiFor } from "@/server/ai";
import { doNotContactCount } from "@/server/do-not-contact";
import { memberCan, requirePermission } from "@/server/permissions";
import { DESCRIBE_MAX, filtersFromWords, searchCompanies } from "@/server/prospect-search";

export const metadata: Metadata = { title: "Find companies" };

/** The filters as one line of words: *Drift av restauranter · Oslo · 5 to 50 employees*. */
function describe(f: ProspectFilters, w: ProspectsMessages, lang: AdminLang): string {
  const size =
    f.employeesMin !== null && f.employeesMax !== null
      ? fillWords(w.employeesRange, { min: f.employeesMin, max: f.employeesMax })
      : f.employeesMin !== null
        ? fillWords(w.employeesAtLeast, { min: f.employeesMin })
        : f.employeesMax !== null
          ? fillWords(w.employeesAtMost, { max: f.employeesMax })
          : null;
  return [...f.industries.map((c) => industryName(c, lang)), ...f.places.map(placeName), size].filter(Boolean).join(" · ");
}

/**
 * Find companies (email plan P5.1 and P5.6, D893), Kaizena Flow's own store first (P5.8): the owner says in words whom they want to reach,
 * the AI turns it into filters (`filtersFromWords()`, then a redirect so the address holds them and paging asks the model nothing), and code
 * asks Brønnøysund's register for a page of matching companies. Under it, the do-not-contact list every store and the platform share. Nothing
 * is written to anyone from here: that waits for P5.3's legal reading.
 */
export default async function ProspectsPage({ params, searchParams }: PageProps<"/admin/[store]/companies/find">) {
  await connection();
  const member = await requirePermission((await params).store, "customers:read");
  const { store } = member;
  if (!store.house) notFound();
  const query = await searchParams;
  const lang = adminLangOf(member.account.adminLocale);
  const w = PROSPECTS_WORDS[lang];
  const base = `/admin/${store.slug}/companies/find`;
  const today = todayIn(new Date(), store.timeZone);
  const one = (k: string) => {
    const v = query[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const words = one("q").slice(0, DESCRIBE_MAX);
  const filters = filtersFromQuery(query);

  // Words without filters yet: the model reads them once, and the page moves to an address that holds what it found.
  let problem: string | null = null;
  if (words && !hasFilters(filters)) {
    const ai = await aiFor(store.id, { feature: "prospect_search", accountId: member.account.id });
    if (!ai?.textModel) problem = w.noAi;
    else {
      const found = await filtersFromWords(ai, words, today);
      if (found) redirect(`${base}?${new URLSearchParams({ q: words, ...filtersToQuery(found) })}`);
      problem = w.notUnderstood;
    }
  }

  const page = Math.max(1, Number.parseInt(one("page"), 10) || 1);
  const result = hasFilters(filters) ? await searchCompanies(filters, page - 1, { today }) : null;
  const canWrite = memberCan(member, "customers:write");
  const listed = canWrite ? await doNotContactCount() : 0;
  const dnc = one("dnc");
  const address = (p: number) => `${base}?${new URLSearchParams({ ...(words ? { q: words } : {}), ...filtersToQuery(filters), page: String(p) })}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} description={w.lead} />

      <Card>
        <form method="get" action={base} className="flex flex-col gap-3">
          <Field label={w.describe} problem={problem ?? undefined}>
            {(control) => <TextInput {...control} name="q" defaultValue={words} placeholder={w.example} maxLength={DESCRIBE_MAX} full />}
          </Field>
          <div>
            <Button type="submit" kind="main">
              {w.find}
            </Button>
          </div>
        </form>
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink-2">{w.customise}</summary>
          <form method="get" action={base} className="mt-3 grid gap-3 sm:grid-cols-2">
            {words && <input type="hidden" name="q" value={words} />}
            <Field label={w.industries} hint={w.industriesHelp}>
              {(control) => <TextInput {...control} name="industries" defaultValue={filters.industries.join(", ")} full />}
            </Field>
            <Field label={w.places} hint={w.placesHelp}>
              {(control) => <TextInput {...control} name="places" defaultValue={filters.places.join(", ")} full />}
            </Field>
            <Field label={w.employeesMin}>{(control) => <TextInput {...control} name="min" type="number" min={0} defaultValue={filters.employeesMin ?? ""} />}</Field>
            <Field label={w.employeesMax}>{(control) => <TextInput {...control} name="max" type="number" min={0} defaultValue={filters.employeesMax ?? ""} />}</Field>
            <Field label={w.foundedFrom}>{(control) => <TextInput {...control} name="from" type="date" defaultValue={filters.foundedFrom ?? ""} />}</Field>
            <Field label={w.foundedTo}>{(control) => <TextInput {...control} name="to" type="date" defaultValue={filters.foundedTo ?? ""} />}</Field>
            <div className="sm:col-span-2">
              <Button type="submit">{w.apply}</Button>
            </div>
          </form>
        </details>
      </Card>

      {result && (
        <section className="flex flex-col gap-3" aria-labelledby="found">
          <p className="text-body text-ink-2">{fillWords(w.searching, { filters: describe(filters, w, lang) })}</p>
          {!result.ok ? (
            <p role="alert" className="text-body text-ink">
              {w.failed}
            </p>
          ) : (
            <>
              {result.total === 0 ? (
                <EmptyState title={w.found.none} compact />
              ) : (
                <h2 id="found" className="text-title text-ink">
                  {result.total >= RESULTS_MAX ? w.tooMany : countWords(result.total, w.found)}
                </h2>
              )}
              <ul className="flex flex-col gap-2">
                {result.companies.map((c) => {
                  const domain = c.website ? foldDomain(c.website) : null;
                  const blocked = domain ? result.blocked.has(domain) : false;
                  return (
                    <li key={c.number}>
                      <Card>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <h3 className="text-body-strong text-ink">{c.name ?? c.number}</h3>
                          {blocked && <span className="text-caption text-ink-2">{w.blocked}</span>}
                        </div>
                        <p className="text-sm text-ink-2">
                          {[
                            c.industryName,
                            c.employees !== null ? countWords(c.employees, w.employees) : null,
                            c.municipality,
                            c.founded ? fillWords(w.founded, { date: adminDate(store.timeZone, c.founded, "day", lang) }) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                        <p className="mt-1 flex flex-wrap gap-4 text-sm">
                          {c.website && !blocked && (
                            <a href={c.website} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                              {w.website}
                            </a>
                          )}
                          <a href={`https://virksomhet.brreg.no/nb/oppslag/enheter/${c.number}`} target="_blank" rel="noopener noreferrer" className="underline">
                            {w.register}
                          </a>
                        </p>
                      </Card>
                    </li>
                  );
                })}
              </ul>
              {result.pages > 1 && result.total < RESULTS_MAX && (
                <nav className="flex items-center gap-3" aria-label={fillWords(w.pageOf, { page, pages: result.pages })}>
                  {page > 1 && <ButtonLink href={address(page - 1)}>{w.previous}</ButtonLink>}
                  <span className="text-sm text-ink-2">{fillWords(w.pageOf, { page, pages: result.pages })}</span>
                  {page < result.pages && <ButtonLink href={address(page + 1)}>{w.next}</ButtonLink>}
                </nav>
              )}
            </>
          )}
          <p className="text-caption text-muted">{w.how}</p>
        </section>
      )}

      {canWrite && (
        <Card>
          <h2 className="text-title text-ink">{w.dnc.title}</h2>
          <p className="mt-1 text-body text-ink-2">{w.dnc.lead}</p>
          {listed > 0 && <p className="mt-1 text-sm text-ink-2">{countWords(listed, w.dnc.count)}</p>}
          <form method="post" action={`${base}/do-not-contact`} className="mt-3 flex flex-col gap-3">
            <Field label={w.dnc.entry} hint={w.dnc.kept} problem={dnc === "invalid" ? w.dnc.invalid : undefined}>
              {(control) => <TextInput {...control} name="entry" maxLength={320} autoComplete="off" full />}
            </Field>
            {dnc === "added" && (
              <p role="status" className="text-sm text-ink">
                {w.dnc.added}
              </p>
            )}
            <div>
              <Button type="submit">{w.dnc.add}</Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
