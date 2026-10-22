"use client";

import Link from "next/link";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import type { PrivacyCard as PrivacyCardData } from "@/server/privacy-admin";

import { alertText, buttonPrimary, buttonSecondary, card, clockWords, dayText } from "./styles";

/**
 * The banner at the top of a customer's page when staff logged a request for them that is past its day (wave 1, 1g, D162,
 * `docs/wave-1g-gdpr.md` 2.3 item 1). It says it in words and links the request; it shows nothing for a request that is on time.
 */
export function PrivacyBanner({ base, data }: { base: string; data: PrivacyCardData }) {
  const { card: w, common: c } = useAdminText("privacy");
  const request = data.request;
  if (!request || !data.overdue) return null;
  return (
    <p role="alert" className="rounded-md border border-danger-text bg-card p-3 text-sm">
      <span className={`font-medium ${alertText}`}>{w.overdueBanner}</span>{" "}
      <Link href={`${base}/privacy/${request.id}`} className="underline">
        {c.openRequest}
      </Link>
      .
    </p>
  );
}

/**
 * The *Privacy* card of a customer's page: what the store holds about the person in counts per kind, the open request if there is one, the
 * download (a POST to the export route, never a link a crawler could follow) and the erasure (a page of its own with a preview).
 * Reading it is `customers:read`; the two buttons are shown only to a member who may change customers. Drawn in the browser, so it reads
 * the admin's language from the page's `AdminTextScope` (the `privacy` area): the counts line is the server's in English and made again
 * from the counts in any other language.
 */
export function PrivacyCard({
  base,
  customerKey,
  data,
  canWrite,
  timeZone,
  exportProblem,
}: {
  /** `/admin/{store}` */
  base: string;
  /** The customer page's own key. */
  customerKey: string;
  data: PrivacyCardData;
  /** `customers:write`. */
  canWrite: boolean;
  timeZone?: string;
  /** A refused download's fixed sentence (from `?export=` on the page), never text from the address. */
  exportProblem?: string | null;
}) {
  const { card: w, common: c, staff, problems } = useAdminText("privacy");
  const lang = useAdminLang();
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const day = (value: Date | string | null | undefined) => dayText(value, timeZone, locale);
  const sections: Record<string, string> = w.sections;
  // "3 orders, 2 emails", as `countsLine()` writes it (kept out of the browser with the register it loads).
  const counts: Record<string, number> = data.counts;
  const line =
    data.countsLine && lang !== "en"
      ? Object.entries(counts)
          .filter(([, n]) => n > 0)
          .map(([key, n]) => `${n} ${sections[key] ?? key}`)
          .join(", ")
      : data.countsLine;
  const request = data.request;
  return (
    <section aria-labelledby="privacy" className={`${card} text-sm`}>
      <div>
        <h2 id="privacy" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="mt-1 text-muted">{line ? fillWords(w.holds, { counts: line }) : w.holdsNothing}</p>
      </div>
      {exportProblem && (
        <p role="alert" className="rounded-md border border-danger-text p-2">
          {problems[exportProblem] ?? exportProblem}
        </p>
      )}
      {request && (
        <p className="rounded-md border border-line p-3">
          <span className="block font-medium">{fillWords(w.requestOpen, { kind: c.kinds[request.kind] })}</span>
          <span className="block text-muted">
            {fillWords(w.receivedDue, { received: day(request.receivedAt), due: day(request.extendedUntil ?? request.dueAt) })}
            {" · "}
            <span className={data.overdue ? `font-medium ${alertText}` : undefined}>{clockWords(request.daysLeft, data.overdue, c.clock)}</span>
          </span>
          <Link href={`${base}/privacy/${request.id}`} className="underline">
            {c.openRequest}
          </Link>
        </p>
      )}
      {canWrite ? (
        <>
          <p className="text-muted">{staff.downloadWarning}</p>
          <div className="flex flex-wrap gap-2">
            <form method="post" action={`${base}/customers/${customerKey}/export`}>
              <button type="submit" className={buttonSecondary}>
                {c.downloadData}
              </button>
            </form>
            <Link href={`${base}/customers/${customerKey}/erase${request ? `?request=${request.id}` : ""}`} className={buttonPrimary}>
              {c.eraseData}
            </Link>
          </div>
          <p className="text-xs text-muted">{w.fileNote}</p>
        </>
      ) : (
        <p className="text-muted">{w.needsWrite}</p>
      )}
      <p className="text-xs text-muted">
        <Link href={`${base}/privacy`} className="underline">
          {w.allRequests}
        </Link>
      </p>
    </section>
  );
}
