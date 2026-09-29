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

import { clearAction, generateAction, planAction, reviewAction, saveGroupAction } from "../actions";

export const metadata: Metadata = { title: "Translate a language" };

const FILTERS = { all: "All", open: "To read", missing: "Missing", stale: "Out of date" } as const;
type Filter = keyof typeof FILTERS;

const area = "w-full rounded-md border border-border bg-background px-2 py-1 text-sm";

/**
 * One language's interface text (D111): translate it with AI, then read it,
 * edit what is wrong and mark it reviewed. Grouped by where the texts are
 * used; a group is one form.
 */
export default async function LanguagePage({ params, searchParams }: PageProps<"/admin/platform/languages/[lang]">) {
  await connection();
  await requirePlatformAdmin();
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
    <div className="flex max-w-6xl flex-col gap-6">
      <div>
        <Link href="/admin/platform/languages" className="text-sm underline">← Languages</Link>
        <h1 className="text-2xl font-semibold">{language.name} <span className="text-base font-normal text-muted">· {nativeName(lang)}</span></h1>
        <p className="max-w-3xl text-sm text-muted">
          The interface text of stores and emails in this language. The AI writes a draft; read it, correct what is wrong
          and mark it reviewed. Terms of purchase, withdrawal information and other legal texts are not in here: they
          are written and reviewed by the store, not translated by the AI.
        </p>
      </div>

      <UiTranslator
        name={language.name}
        counts={counts}
        plan={planAction.bind(null, lang)}
        generate={generateAction.bind(null, lang)}
      />

      <div className="flex flex-wrap items-center gap-3">
        <ActionForm action={reviewAction.bind(null, lang, null)}>
          <SubmitButton variant="secondary" disabled={counts.open === 0}>Mark all {counts.open} unread as reviewed</SubmitButton>
        </ActionForm>
        <ActionForm action={clearAction.bind(null, lang)}>
          <SubmitButton variant="secondary" disabled={rows.size === 0}>Remove every text</SubmitButton>
        </ActionForm>
      </div>

      <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="Where the texts are used" className="flex flex-col gap-1 text-sm">
          {names.map((name) => {
            const g = groups.get(name)!;
            return (
              <Link key={name} href={href(name, filter)} aria-current={name === current ? "page" : undefined}
                className="flex items-center justify-between rounded-md px-3 py-1.5 hover:bg-surface aria-[current=page]:bg-foreground aria-[current=page]:text-background">
                <span>{name}</span>
                <span className="text-xs opacity-80">{g.open > 0 ? `${g.open} of ${g.total}` : "✓"}</span>
              </Link>
            );
          })}
        </nav>

        <section aria-labelledby="group-heading" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="group-heading" className="text-lg font-semibold">{current}</h2>
            <div role="group" aria-label="Show" className="flex gap-1 text-sm">
              {(Object.keys(FILTERS) as Filter[]).map((f) => (
                <Link key={f} href={href(current, f)} aria-current={f === filter ? "true" : undefined}
                  className="rounded-md border border-border px-3 py-1 aria-[current=true]:bg-foreground aria-[current=true]:text-background">
                  {FILTERS[f]}
                </Link>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="text-sm text-muted">Nothing here for this filter.</p>
          ) : (
            <ActionForm action={saveGroupAction.bind(null, lang)} className="flex flex-col gap-4">
              <ul className="flex flex-col gap-3">
                {shown.map((entry) => {
                  const row = rows.get(entry.key);
                  const state = stateOf(entry.key, entry.source);
                  return (
                    <li key={entry.key} className="grid gap-2 rounded-md border border-border bg-background p-3 md:grid-cols-2">
                      <div className="flex flex-col gap-1 text-sm">
                        <span className="text-xs text-muted">{entry.key.replace(/^(ui|email):/, "")}{state === "stale" && " · English has changed"}</span>
                        <span className="whitespace-pre-wrap">{entry.source}</span>
                      </div>
                      <div className="flex flex-col gap-1">
                        <textarea
                          name={`t:${entry.key}`}
                          defaultValue={row?.text ?? ""}
                          rows={Math.min(6, Math.max(1, Math.ceil((row?.text ?? entry.source).length / 45)))}
                          lang={lang}
                          placeholder={state === "missing" ? "Not translated" : undefined}
                          aria-label={`${entry.key} in ${language.name}`}
                          className={area}
                        />
                        <input type="hidden" name={`was:${entry.key}`} value={row?.text ?? ""} />
                        <span className="text-xs text-muted">
                          {state === "missing" ? "Missing" : row?.origin === "staff" ? "Written by a person" : "Written by the AI"}
                          {state === "reviewed" && " · reviewed"}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div><SubmitButton>Save changes in {current}</SubmitButton></div>
            </ActionForm>
          )}
          {shown.length > 0 && (
            <ActionForm action={reviewAction.bind(null, lang, shown.filter((e) => stateOf(e.key, e.source) === "open").map((e) => e.key))}>
              <SubmitButton variant="secondary" disabled={!shown.some((e) => stateOf(e.key, e.source) === "open")}>Mark the ones shown as reviewed</SubmitButton>
            </ActionForm>
          )}
        </section>
      </div>
    </div>
  );
}

/** Where a text is used: its first part (`cart`, `stay`), else "General"; the emails' apart. */
function groupName(key: string): string {
  const [ns, path] = key.split(":");
  const first = path.includes(".") ? path.split(".")[0] : "general";
  return ns === "email" ? `Emails: ${first}` : first === "general" ? "General" : first;
}
