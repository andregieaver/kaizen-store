"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { momentText } from "@/lib/data-admin";
import type { Finding } from "@/lib/data-job";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { requestsWords, suggestionKind, suggestionWords } from "@/lib/redirect-admin";
import { redirectProblems } from "@/lib/redirect-words";

import { useAdminLang, useAdminText } from "../admin-text";

import { FindingList } from "./redirect-form";

export type MissingRow = {
  path: string;
  requests: number;
  crawlers: number;
  lastAsked: string;
  covered: boolean;
  ignored: boolean;
  suggestions: { kind: string; path: string; title: string }[];
};

export type ReportActions = {
  redirect: (path: string, to: string) => Promise<{ ok: true; target?: string } | { ok: false; problems: string[]; findings?: Finding[] }>;
  ignore: (path: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
  restore: (path: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
};

/**
 * The report's rows (2.3): the address, how often it was asked for (shoppers and robots together, with the robots' share), when it was last asked, whether a
 * redirect covers it now, and what to do. A member who may change the website gets one button for each suggested target (found in code from the store's own
 * addresses, never a model: one press makes the manual redirect), a short form for any other target, and *Ignore* (hide the address from the default view;
 * *Restore* brings it back). A row that was redirected here says so at once and keeps no buttons. Every change goes through the page's bound actions.
 */
export function NotFoundTable({ rows, timeZone, actions, canWrite }: { rows: MissingRow[]; timeZone: string; actions: ReportActions; canWrite: boolean }) {
  const t = useAdminText("redirects").report.table;
  return (
    <div className={tableShell}>
      <table className="w-full text-sm">
        <caption className="sr-only">{t.caption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>
              {t.address}
            </th>
            <th scope="col" className={th}>
              {t.requests}
            </th>
            <th scope="col" className={`${th} hidden md:table-cell`}>
              {t.lastAsked}
            </th>
            <th scope="col" className={th}>
              {t.covered}
            </th>
            <th scope="col" className={th}>
              {canWrite ? t.fix : <span className="sr-only">{t.fix}</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <MissingRowView key={row.path} row={row} timeZone={timeZone} actions={actions} canWrite={canWrite} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MissingRowView({ row, timeZone, actions, canWrite }: { row: MissingRow; timeZone: string; actions: ReportActions; canWrite: boolean }) {
  const w = useAdminText("redirects");
  const t = w.report.table;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const router = useRouter();
  const id = useId();
  const [done, setDone] = useState<string | null>(null);
  const [hiddenNow, setHiddenNow] = useState<boolean | null>(null);
  const [form, setForm] = useState(false);
  const [target, setTarget] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [pending, start] = useTransition();
  const ignored = hiddenNow ?? row.ignored;

  const redirect = (to: string) =>
    start(async () => {
      setProblems([]);
      setFindings([]);
      const result = await actions.redirect(row.path, to);
      if (!result.ok) {
        setProblems(redirectProblems(result.problems, w));
        setFindings(result.findings ?? []);
        return;
      }
      setDone(result.target ?? to);
      setForm(false);
      router.refresh();
    });

  const toggleIgnored = () =>
    start(async () => {
      setProblems([]);
      const result = await (ignored ? actions.restore(row.path) : actions.ignore(row.path));
      if (!result.ok) {
        setProblems(redirectProblems(result.problems, w));
        return;
      }
      setHiddenNow(!ignored);
      router.refresh();
    });

  return (
    <tr className="border-b border-line last:border-0" aria-busy={pending}>
      <td className={td}>
        <code className="break-all text-xs">{row.path}</code>
      </td>
      <td className={td}>
        <span className="whitespace-nowrap">{requestsWords(row.requests, row.crawlers, w, locale)}</span>
      </td>
      <td className={`${td} hidden md:table-cell`}>{momentText(row.lastAsked, timeZone, locale)}</td>
      <td className={td}>{done ? t.justNow : row.covered ? t.yes : ignored ? t.hidden : t.no}</td>
      <td className={td}>
        {done ? (
          <p className="text-sm">
            {t.redirectsTo} <code className="break-all text-xs">{done}</code>.
          </p>
        ) : !canWrite || row.covered ? null : (
          <div className="flex flex-col gap-2">
            {row.suggestions.length > 0 && (
              <ul className="flex flex-col gap-1" aria-label={fillWords(t.suggestedFor, { path: row.path })}>
                {row.suggestions.map((s) => (
                  <li key={s.path}>
                    <button type="button" disabled={pending} onClick={() => redirect(s.path)} className={`${primary} !min-h-9 !px-3 !text-xs`} aria-label={`${suggestionWords(s.path, w)} (${suggestionKind(s.kind, w)}: ${s.title})`}>
                      {suggestionWords(s.path, w)}
                    </button>
                    <span className={`${hint} ml-2`}>
                      {suggestionKind(s.kind, w)}: {s.title}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {form ? (
              <form
                className="flex flex-col gap-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (target.trim()) redirect(target);
                }}
              >
                <label htmlFor={`${id}-to`} className="text-xs font-medium">
                  {fillWords(t.redirectPathTo, { path: row.path })}
                </label>
                <div className="flex flex-wrap gap-2">
                  <input id={`${id}-to`} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="/category/shoes" autoComplete="off" spellCheck={false} className={`${field} min-w-40 flex-1 font-mono`} />
                  <button type="submit" disabled={pending || target.trim() === ""} className={primary}>
                    {t.add}
                  </button>
                  <button type="button" onClick={() => setForm(false)} className={secondary}>
                    {w.common.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap gap-3 text-xs">
                <button type="button" onClick={() => setForm(true)} className="underline underline-offset-2">
                  {row.suggestions.length > 0 ? t.another : t.redirect}
                </button>
                <button type="button" disabled={pending} onClick={toggleIgnored} className="underline underline-offset-2">
                  {ignored ? t.restore : t.ignore}
                </button>
              </div>
            )}
            <FindingList findings={findings.filter((f) => f.severity === "error")} />
            {problems.length > 0 && (
              <ul role="alert" className="list-disc pl-5 text-xs text-danger-text">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {canWrite && row.covered && ignored && (
          <button type="button" disabled={pending} onClick={toggleIgnored} className="text-xs underline underline-offset-2">
            {t.restore}
          </button>
        )}
      </td>
    </tr>
  );
}
