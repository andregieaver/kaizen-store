import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { UiTranslator } from "@/components/admin/ui-translator";
import { nativeName } from "@/lib/languages";
import { sourceHash } from "@/lib/ui-catalog";
import { fullCatalog, isBuiltIn } from "@/lib/ui-catalog-all";
import { requirePlatformAdmin } from "@/server/auth";
import { listLanguages } from "@/server/languages";
import { uiRows } from "@/server/ui-text";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";

import { clearAction, generateAction, planAction, reviewAction, saveGroupAction } from "../actions";

export const metadata: Metadata = { title: "Translate a language" };

const FILTERS = { all: true, open: true, missing: true, stale: true } as const;
type Filter = keyof typeof FILTERS;

const area = "w-full rounded-md border border-line bg-card px-2 py-1 text-sm";

/**
 * One language's interface text (D111): translate it with AI, then read it,
 * edit what is wrong and mark it reviewed. Grouped by where the texts are
 * used; a group is one form.
 */
export default async function LanguagePage({ params, searchParams }: PageProps<"/admin/platform/languages/[lang]">) {
  await connection();
  const account = await requirePlatformAdmin();
  const adminLang = adminLangOf(account.adminLocale);
  const w = adminText(adminLang, "platformTools").languages.one;
  const { lang } = await params;
  const { group: groupParam, show } = await searchParams;
  const language = (await listLanguages()).find((l) => l.lang === lang);
  if (!language || isBuiltIn(lang)) notFound();
  const rows = await uiRows(lang);
  const catalog = fullCatalog();

  const stateOf = (key: string, source: string) => {
    const row = rows.get(key);
    if (!row) return "missing" as const;
    if (row.sourceHash !== sourceHash(source)) return "stale" as const;
    return row.reviewed ? ("reviewed" as const) : ("open" as const);
  };
  const counts = { missing: 0, stale: 0, ai: 0, open: 0 };
  const groups = new Map<string, { total: number; open: number }>();
  for (const entry of catalog) {
    const state = stateOf(entry.key, entry.source);
    const row = rows.get(entry.key);
    if (state === "missing") counts.missing += 1;
    if (state === "stale") counts.stale += 1;
    if (row?.origin === "ai") counts.ai += 1;
    if (state === "open") counts.open += 1;
    const name = groupName(entry.key);
    const g = groups.get(name) ?? { total: 0, open: 0 };
    g.total += 1;
    if (state !== "reviewed") g.open += 1;
    groups.set(name, g);
  }
  const filter: Filter = typeof show === "string" && show in FILTERS ? (show as Filter) : "all";
  const names = [...groups.keys()];
  const current = typeof groupParam === "string" && groups.has(groupParam) ? groupParam : (names.find((n) => (groups.get(n)?.open ?? 0) > 0) ?? names[0]);
  const shown = catalog.filter((entry) => {
    if (groupName(entry.key) !== current) return false;
    const state = stateOf(entry.key, entry.source);
    return filter === "all" || (filter === "open" && (state === "open" || state === "stale")) || filter === state;
  });
  const href = (g: string, f: Filter) => `/admin/platform/languages/${lang}?group=${encodeURIComponent(g)}&show=${f}`;

  return (
    <AdminTextScope texts={adminTexts(adminLang, ["platformTools"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/languages", label: w.back }}
        title={language.name}
        meta={[nativeName(lang)]}
        description={w.intro}
      />

      <UiTranslator
        name={language.name}
        counts={counts}
        plan={planAction.bind(null, lang)}
        generate={generateAction.bind(null, lang)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <ActionForm action={reviewAction.bind(null, lang, null)}>
          <SubmitButton variant="secondary" disabled={counts.open === 0}>{fillWords(w.markAll, { n: counts.open })}</SubmitButton>
        </ActionForm>
        <ActionForm action={clearAction.bind(null, lang)}>
          <SubmitButton variant="secondary" disabled={rows.size === 0}>{w.removeAll}</SubmitButton>
        </ActionForm>
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label={w.where} className="flex flex-col gap-1 text-sm">
          {names.map((name) => {
            const g = groups.get(name)!;
            return (
              <Link key={name} href={href(name, filter)} aria-current={name === current ? "page" : undefined}
                className="flex items-center justify-between rounded-pill px-3 py-1.5 hover:bg-sunken aria-[current=page]:bg-inverse aria-[current=page]:text-inverse-ink">
                <span>{name}</span>
                <span className="text-xs opacity-80">{g.open > 0 ? fillWords(w.groupCount, { open: g.open, total: g.total }) : "✓"}</span>
              </Link>
            );
          })}
        </nav>

        <section aria-labelledby="group-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="group-heading" className="text-title text-ink">{current}</h2>
            <div role="group" aria-label={w.show} className="flex gap-1 text-sm">
              {(Object.keys(FILTERS) as Filter[]).map((f) => (
                <Link key={f} href={href(current, f)} aria-current={f === filter ? "true" : undefined}
                  className="rounded-pill border border-edge px-3 py-1 aria-[current=true]:bg-inverse aria-[current=true]:text-inverse-ink">
                  {w.filters[f]}
                </Link>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted">{w.nothing}</p>
          ) : (
            <ActionForm action={saveGroupAction.bind(null, lang)} className="flex flex-col gap-4">
              <ul className="flex flex-col gap-3">
                {shown.map((entry) => {
                  const row = rows.get(entry.key);
                  const state = stateOf(entry.key, entry.source);
                  return (
                    <li key={entry.key} className="grid gap-2 rounded-md border border-line bg-card p-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-xs text-muted">{entry.key.replace(/^(ui|email):/, "")}{state === "stale" && w.englishChanged}</span>
                        <span className="whitespace-pre-wrap">{entry.source}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <textarea
                          name={`t:${entry.key}`}
                          defaultValue={row?.text ?? ""}
                          rows={Math.min(6, Math.max(1, Math.ceil((row?.text ?? entry.source).length / 45)))}
                          lang={lang}
                          placeholder={state === "missing" ? w.notTranslated : undefined}
                          aria-label={fillWords(w.inLanguage, { key: entry.key, language: language.name })}
                          className={area}
                        />
                        <input type="hidden" name={`was:${entry.key}`} value={row?.text ?? ""} />
                        <span className="text-xs text-muted">
                          {state === "missing" ? w.missing : row?.origin === "staff" ? w.byPerson : w.byAi}
                          {state === "reviewed" && w.reviewed}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div><SubmitButton>{fillWords(w.saveGroup, { group: current })}</SubmitButton></div>
            </ActionForm>
          )}
          {shown.length > 0 && (
            <ActionForm action={reviewAction.bind(null, lang, shown.filter((e) => stateOf(e.key, e.source) === "open").map((e) => e.key))}>
              <SubmitButton variant="secondary" disabled={!shown.some((e) => stateOf(e.key, e.source) === "open")}>{w.markShown}</SubmitButton>
            </ActionForm>
          )}
        </section>
      </div>
    </div>
    </AdminTextScope>
  );
}

/** Where a text is used: its first part (`cart`, `stay`), else "General"; the emails' apart. */
function groupName(key: string): string {
  const [ns, path] = key.split(":");
  const first = path.includes(".") ? path.split(".")[0] : "general";
  return ns === "email" ? `Emails: ${first}` : first === "general" ? "General" : first;
}
