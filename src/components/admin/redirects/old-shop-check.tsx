"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { Finding } from "@/lib/data-job";
import type { OldKind } from "@/lib/old-shop";
import { suggestionKind, suggestionWords } from "@/lib/redirect-admin";
import { redirectProblems } from "@/lib/redirect-words";

import { useAdminText } from "../admin-text";

import { FindingList } from "./redirect-form";

type Problem = "address" | "unreachable" | "no_sitemap" | "own_shop" | "empty" | "forbidden" | "failed";
type Step = { ok: true; written?: number; refused?: number } | { ok: false; problem: Problem };
type RedirectStep = { ok: true; target?: string } | { ok: false; problems: string[]; findings?: Finding[] };

export type OldShopActions = {
  read: (address: string) => Promise<Step>;
  fix: () => Promise<Step>;
  forget: () => Promise<Step>;
  redirect: (path: string, to: string) => Promise<RedirectStep>;
};

export type NeedingRow = { path: string; kind: OldKind; fate: "missing" | "broken" | "live" | "redirected"; sure: string | null; suggestions: { kind: string; path: string; title: string }[] };

/**
 * The start of the check (D445 step 1): the old shop's address and one button. Also *Check again* with the address filled in. Only the sitemap
 * is read; the page says so under the field.
 */
export function OldShopStart({ read, initial = "", again = false }: { read: OldShopActions["read"]; initial?: string; again?: boolean }) {
  const w = useAdminText("redirects").oldShop;
  const router = useRouter();
  const id = useId();
  const [address, setAddress] = useState(initial);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setProblem(null);
      const result = await read(address);
      if (!result.ok) {
        setProblem(result.problem);
        return;
      }
      router.refresh();
    });
  if (again)
    return (
      <div className="flex flex-col gap-1">
        <button type="button" disabled={pending} onClick={submit} className={secondary}>
          {pending ? w.start.working : w.again}
        </button>
        {problem && (
          <p role="alert" className="text-sm text-danger-text">
            {w.problems[problem]}
          </p>
        )}
      </div>
    );
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (address.trim()) submit();
      }}
    >
      <label htmlFor={`${id}-address`} className="text-sm font-medium">
        {w.start.label}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={`${id}-address`}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="myshop.com"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          aria-describedby={`${id}-help`}
          className={`${field} min-w-56 flex-1`}
        />
        <button type="submit" disabled={pending || address.trim() === ""} className={primary}>
          {pending ? w.start.working : w.start.button}
        </button>
      </div>
      <p id={`${id}-help`} className={hint}>
        {w.start.help}
      </p>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {w.problems[problem]}
        </p>
      )}
    </form>
  );
}

/** The one press: a redirect from every old link with a sure target. Says how many were made, and how many could not be. */
export function OldShopFix({ fix, count }: { fix: OldShopActions["fix"]; count: number }) {
  const w = useAdminText("redirects").oldShop;
  const router = useRouter();
  const [done, setDone] = useState<{ written: number; refused: number } | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      {done ? (
        <p role="status" className="text-sm">
          {countWords(done.written, w.fixed)} {done.refused > 0 ? countWords(done.refused, w.refused) : ""}
        </p>
      ) : (
        <>
          <div>
            <button
              type="button"
              disabled={pending}
              className={primary}
              onClick={() =>
                start(async () => {
                  setProblem(null);
                  const result = await fix();
                  if (!result.ok) {
                    setProblem(result.problem);
                    return;
                  }
                  setDone({ written: result.written ?? 0, refused: result.refused ?? 0 });
                  router.refresh();
                })
              }
            >
              {pending ? w.fixing : countWords(count, w.fixSure)}
            </button>
          </div>
          <p className={hint}>{w.fixSureHelp}</p>
        </>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {w.problems[problem]}
        </p>
      )}
    </div>
  );
}

/** *Forget this shop*, behind a question. The redirects made stay. */
export function OldShopForget({ forget }: { forget: OldShopActions["forget"] }) {
  const w = useAdminText("redirects");
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  if (!asking)
    return (
      <button type="button" onClick={() => setAsking(true)} className="text-sm underline underline-offset-2">
        {w.oldShop.forget}
      </button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label={w.oldShop.forget}>
      <span>{w.oldShop.forgetAsk}</span>
      <button
        type="button"
        disabled={pending}
        className={secondary}
        onClick={() =>
          start(async () => {
            await forget();
            setAsking(false);
            router.refresh();
          })
        }
      >
        {w.oldShop.forget}
      </button>
      <button type="button" onClick={() => setAsking(false)} className="underline underline-offset-2">
        {w.common.cancel}
      </button>
    </div>
  );
}

/** The old links that lead nowhere and have no sure target: each with up to three suggestions and a short form for another address. */
export function OldShopTable({ rows, redirect, canWrite }: { rows: NeedingRow[]; redirect: OldShopActions["redirect"]; canWrite: boolean }) {
  const w = useAdminText("redirects").oldShop;
  return (
    <div className={tableShell}>
      <table className="w-full text-sm">
        <caption className="sr-only">{w.table.caption}</caption>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={th}>
              {w.table.address}
            </th>
            <th scope="col" className={`${th} hidden md:table-cell`}>
              {w.table.what}
            </th>
            <th scope="col" className={th}>
              {canWrite ? w.table.fix : <span className="sr-only">{w.table.fix}</span>}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <OldRow key={row.path} row={row} redirect={redirect} canWrite={canWrite} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OldRow({ row, redirect, canWrite }: { row: NeedingRow; redirect: OldShopActions["redirect"]; canWrite: boolean }) {
  const words = useAdminText("redirects");
  const w = words.oldShop;
  const t = words.report.table;
  const router = useRouter();
  const id = useId();
  const [done, setDone] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const [target, setTarget] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [pending, start] = useTransition();
  const send = (to: string) =>
    start(async () => {
      setProblems([]);
      setFindings([]);
      const result = await redirect(row.path, to);
      if (!result.ok) {
        setProblems(redirectProblems(result.problems, words));
        setFindings(result.findings ?? []);
        return;
      }
      setDone(result.target ?? to);
      setForm(false);
      router.refresh();
    });
  return (
    <tr className="border-b border-line last:border-0" aria-busy={pending}>
      <td className={td}>
        <code className="break-all text-xs">{row.path}</code>
        {row.fate === "broken" && <p className={hint}>{w.fates.broken}</p>}
      </td>
      <td className={`${td} hidden md:table-cell`}>{w.kinds[row.kind]}</td>
      <td className={td}>
        {done ? (
          <p className="text-sm">
            {t.redirectsTo} <code className="break-all text-xs">{done}</code>.
          </p>
        ) : !canWrite ? null : (
          <div className="flex flex-col gap-2">
            {row.suggestions.length > 0 && (
              <ul className="flex flex-col gap-1" aria-label={fillWords(t.suggestedFor, { path: row.path })}>
                {row.suggestions.map((s) => (
                  <li key={s.path}>
                    <button type="button" disabled={pending} onClick={() => send(s.path)} className={`${primary} !min-h-9 !px-3 !text-xs`} aria-label={`${suggestionWords(s.path, words)} (${suggestionKind(s.kind, words)}: ${s.title})`}>
                      {suggestionWords(s.path, words)}
                    </button>
                    <span className={`${hint} ml-2`}>
                      {suggestionKind(s.kind, words)}: {s.title}
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
                  if (target.trim()) send(target);
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
                    {words.common.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <div className="text-xs">
                <button type="button" onClick={() => setForm(true)} className="underline underline-offset-2">
                  {row.suggestions.length > 0 ? t.another : t.redirect}
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
      </td>
    </tr>
  );
}
