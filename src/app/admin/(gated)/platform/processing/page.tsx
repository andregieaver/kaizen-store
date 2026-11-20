import type { Metadata } from "next";

import { PhoneRow } from "@/components/admin/phone-row";
import { connection } from "next/server";

import { AdminTextScope } from "@/components/admin/admin-text";
import { PageHeader } from "@/components/admin/ui/page-header";
import { adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { PERSONAL_DATA } from "@/lib/personal-data";
import { processingRecord } from "@/lib/personal-purposes";
import { areaTexts } from "@/lib/admin-area";
import { PRIVACY_WORDS } from "@/lib/admin-words/privacy";
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
  const w = PRIVACY_WORDS[lang];
  const r = w.record;
  const rows = processingRecord(PERSONAL_DATA);
  return (
    <AdminTextScope texts={areaTexts(lang, { privacy: PRIVACY_WORDS })}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title={r.title}
          description={
            <>
              <span className="sm:hidden">{r.phone.lead}</span>
              <span className="max-sm:hidden">{r.description}</span>
            </>
          }
        />
        {/* Round 64 (D830): on a phone each purpose is a row of one card, its basis and who decides under it, opening the whole record. */}
        <ol className="flex flex-col gap-4 max-sm:gap-0 max-sm:overflow-hidden max-sm:rounded-panel" data-processing-record="">
          {rows.map((row, index) => (
            <li key={row.purpose} className="rounded-panel border border-line bg-card p-5 max-sm:rounded-none max-sm:border-0 max-sm:bg-transparent max-sm:p-0">
              <PhoneRow
                last={index === rows.length - 1}
                title={row.what}
                sub={[row.basisText.split(":")[0], r.controllers[row.controller], row.review ? r.phone.review : null].filter(Boolean).join(" · ")}
                change={r.phone.open}
                done={r.phone.close}
              >
              <h2 className="text-title text-ink max-sm:sr-only">{row.what}</h2>
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
              </PhoneRow>
            </li>
          ))}
        </ol>
      </div>
    </AdminTextScope>
  );
}
