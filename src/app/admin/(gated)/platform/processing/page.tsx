import type { Metadata } from "next";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PageHeader } from "@/components/admin/ui/page-header";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText, adminTexts } from "@/lib/admin-text";
import { PERSONAL_DATA } from "@/lib/personal-data";
import { processingRecord } from "@/lib/personal-purposes";
import { requirePlatformReader } from "@/server/auth";

export const metadata: Metadata = { title: "Record of processing" };

/**
 * The record of processing (GDPR Art. 30, PSI REG-01): one row per purpose, drawn from the register of personal data by
 * `processingRecord()`, so it never falls behind the code. The purposes, bases and reasons are written in English in
 * `src/lib/personal-purposes.ts` as proposals for the lawyer (`docs/wave-1g-gdpr.md` 3.6); the headings follow the admin's language.
 * Platform admins only; nothing here is a person's data.
 */
export default async function PlatformProcessingPage() {
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "privacy");
  const r = w.record;
  const rows = processingRecord(PERSONAL_DATA);
  return (
    <AdminTextScope texts={adminTexts(lang, ["privacy"])}>
      <div className="flex flex-col gap-6">
        <PageHeader title={r.title} description={r.description} />
        <ol className="flex flex-col gap-4" data-processing-record="">
          {rows.map((row) => (
            <li key={row.purpose} className="rounded-panel border border-line bg-card p-5">
              <h2 className="text-title text-ink">{row.what}</h2>
              {row.review && <p className="mt-1 text-xs font-medium text-warning-text">{r.review}</p>}
              <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
                <dt className="text-muted">{r.basis}</dt>
                <dd>
                  <span className="font-medium">{row.basisText}</span>
                  <span className="block text-muted">{row.why}</span>
                </dd>
                <dt className="text-muted">{r.controller}</dt>
                <dd>{r.controllers[row.controller]}</dd>
                <dt className="text-muted">{r.subjects}</dt>
                <dd>{row.subjects.map((s) => r.subjectNames[s as keyof typeof r.subjectNames] ?? s).join(", ") || "—"}</dd>
                <dt className="text-muted">{r.retention}</dt>
                <dd>{row.retention.length > 0 ? row.retention.map((k) => w.retention.kinds[k as keyof typeof w.retention.kinds] ?? k).join(", ") : r.untilPurpose}</dd>
                <dt className="text-muted">{r.kept}</dt>
                <dd>
                  <details>
                    <summary className="cursor-pointer">{fillWords(r.tables, { n: row.tables.length })}</summary>
                    <p className="mt-1 font-mono text-xs break-words text-muted">{row.tables.join(", ")}</p>
                  </details>
                </dd>
              </dl>
            </li>
          ))}
        </ol>
      </div>
    </AdminTextScope>
  );
}
