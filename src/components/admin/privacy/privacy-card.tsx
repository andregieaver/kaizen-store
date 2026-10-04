import Link from "next/link";

import { PRIVACY_KIND_LABELS } from "@/lib/privacy-request";
import { STAFF_TEXT } from "@/lib/privacy-text";
import type { PrivacyCard as PrivacyCardData } from "@/server/privacy-admin";

import { alertText, buttonPrimary, buttonSecondary, card, clockWords, dayText } from "./styles";

/**
 * The banner at the top of a customer's page when staff logged a request for them that is past its day (wave 1, 1g, D162,
 * `docs/wave-1g-gdpr.md` 2.3 item 1). It says it in words and links the request; it shows nothing for a request that is on time.
 */
export function PrivacyBanner({ base, data }: { base: string; data: PrivacyCardData }) {
  const request = data.request;
  if (!request || !data.overdue) return null;
  return (
    <p role="alert" className="rounded-md border border-red-700 bg-background p-3 text-sm dark:border-red-400">
      <span className={`font-medium ${alertText}`}>A privacy request for this customer is overdue.</span>{" "}
      <Link href={`${base}/privacy/${request.id}`} className="underline">
        Open the request
      </Link>
      .
    </p>
  );
}

/**
 * The *Privacy* card of a customer's page: what the store holds about the person in counts per kind, the open request if there is one, the
 * download (a POST to the export route, never a link a crawler could follow) and the erasure (a page of its own with a preview).
 * Reading it is `customers:read`; the two buttons are shown only to a member who may change customers.
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
  const request = data.request;
  return (
    <section aria-labelledby="privacy" className={`${card} text-sm`}>
      <div>
        <h2 id="privacy" className="font-medium">
          Privacy
        </h2>
        <p className="mt-1 text-muted">{data.countsLine ? `The store holds: ${data.countsLine}.` : "The store holds no data about this person that a file would list."}</p>
      </div>
      {exportProblem && (
        <p role="alert" className="rounded-md border border-red-700 p-2 dark:border-red-400">
          {exportProblem}
        </p>
      )}
      {request && (
        <p className="rounded-md border border-border p-3">
          <span className="block font-medium">{PRIVACY_KIND_LABELS[request.kind]} request open</span>
          <span className="block text-muted">
            Received {dayText(request.receivedAt, timeZone)}, due {dayText(request.extendedUntil ?? request.dueAt, timeZone)}
            {" · "}
            <span className={data.overdue ? `font-medium ${alertText}` : undefined}>{clockWords(request.daysLeft, data.overdue)}</span>
          </span>
          <Link href={`${base}/privacy/${request.id}`} className="underline">
            Open the request
          </Link>
        </p>
      )}
      {canWrite ? (
        <>
          <p className="text-muted">{STAFF_TEXT.downloadWarning}</p>
          <div className="flex flex-wrap gap-2">
            <form method="post" action={`${base}/customers/${customerKey}/export`}>
              <button type="submit" className={buttonSecondary}>
                Download data
              </button>
            </form>
            <Link href={`${base}/customers/${customerKey}/erase${request ? `?request=${request.id}` : ""}`} className={buttonPrimary}>
              Erase personal data
            </Link>
          </div>
          <p className="text-xs text-muted">The file is downloaded, never emailed. Erasing shows what will happen first and asks you to confirm.</p>
        </>
      ) : (
        <p className="text-muted">Downloading or erasing a customer&apos;s data needs permission to change customers.</p>
      )}
      <p className="text-xs text-muted">
        <Link href={`${base}/privacy`} className="underline">
          All privacy requests
        </Link>
      </p>
    </section>
  );
}
