import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { CONSENT_CATEGORIES } from "@/lib/cookie-consent";
import type { ReviewedItem } from "@/lib/cookie-scan";
import type { CookieScan } from "@/server/cookie-scans";

import { RefreshWhile } from "./refresh-while";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const card = "flex flex-col gap-4 rounded-lg border border-border bg-background p-5";
const input = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";

const KINDS = { cookie: "Cookie", localStorage: "Local storage", sessionStorage: "Session storage" } as const;
const CATEGORY_NAMES = {
  necessary: "Necessary",
  preferences: "Preferences",
  statistics: "Statistics",
  marketing: "Marketing",
} as const;

const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

/** Says what an item is: its category and purpose, from Kaizen or the owner. */
function Description({ item }: { item: ReviewedItem }) {
  if (item.note) {
    return (
      <>
        <span className="font-medium">{CATEGORY_NAMES[item.note.category]}</span> · {item.note.provider}: {item.note.purpose}{" "}
        <span className="text-muted">(your description)</span>
      </>
    );
  }
  if (item.known) {
    return (
      <>
        <span className="font-medium">{CATEGORY_NAMES[item.known.category]}</span> · {item.known.provider}: {item.known.purpose.en}
      </>
    );
  }
  return <span className="font-medium text-red-700 dark:text-red-400">Not described yet</span>;
}

/** The owner's description of an item Kaizen does not know, or a change to it. */
function NoteForm({ item, action }: { item: ReviewedItem; action: Action }) {
  return (
    <details className="mt-2">
      <summary className="w-fit cursor-pointer text-sm underline">
        {item.note ? "Change the description" : "Describe it"}
        <span className="sr-only">: {item.name}</span>
      </summary>
      <ActionForm action={action} className="mt-3 flex max-w-lg flex-col gap-3" successMessage="Saved. The cookie page lists it now.">
        <input type="hidden" name="kind" value={item.kind} />
        <input type="hidden" name="name" value={item.name} />
        <input type="hidden" name="domain" value={item.domain} />
        <label className={label}>
          What it is for
          <select name="category" defaultValue={item.note?.category ?? ""} required className={input}>
            <option value="" disabled>
              Choose…
            </option>
            {CONSENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_NAMES[category]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          Set by
          <input name="provider" defaultValue={item.note?.provider ?? ""} required maxLength={100} placeholder="The service's name" className={input} />
        </label>
        <label className={label}>
          Purpose, as visitors read it
          <textarea
            name="purpose"
            defaultValue={item.note?.purpose ?? ""}
            required
            maxLength={500}
            rows={2}
            className={`${input} py-2`}
          />
        </label>
        <div>
          <SubmitButton>Save the description</SubmitButton>
        </div>
      </ActionForm>
    </details>
  );
}

/**
 * A site's cookie scan (D58): when it last ran and what it found, faults
 * first, with Scan now and a description for each item Kaizen does not
 * know. Only those who may change the site's tools describe items
 * (`noteAction` null for the rest), since descriptions decide what visitors
 * are asked.
 */
export function CookieScanPanel({
  scans,
  lastDone,
  findings,
  scanAction,
  noteAction,
}: {
  scans: CookieScan[];
  lastDone: CookieScan | null;
  findings: ReviewedItem[];
  scanAction: Action;
  noteAction: Action | null;
}) {
  const latest = scans[0] ?? null;
  const active = latest && (latest.status === "queued" || latest.status === "running") ? latest : null;
  const early = findings.filter((item) => item.problem === "early");
  const undescribed = findings.filter((item) => item.problem === "undescribed");
  return (
    <section aria-labelledby="scan-heading" className={card}>
      <div>
        <h2 id="scan-heading" className="font-medium">
          Cookie scan
        </h2>
        <p className="text-sm text-muted">
          Every week a real browser opens the site&apos;s pages, first as a visitor who has not chosen anything and then
          with everything allowed, and records every cookie and storage item it finds, the site&apos;s own and other
          services&apos;. What it finds goes on the cookie page, and anything optional brings the cookie banner.
        </p>
      </div>

      <div className="flex flex-col gap-1 text-sm" role="status">
        {active ? (
          <p>
            {active.status === "queued" ? "A scan is waiting to start; it begins within a minute." : "Scanning now…"}
            <RefreshWhile seconds={5} />
          </p>
        ) : null}
        {lastDone ? (
          <p>
            Last scanned {date.format(new Date(lastDone.finishedAt ?? lastDone.createdAt))}: {lastDone.pages.length}{" "}
            {lastDone.pages.length === 1 ? "page" : "pages"} opened, {lastDone.items.length}{" "}
            {lastDone.items.length === 1 ? "item" : "items"} found.
          </p>
        ) : (
          !active && <p>Not scanned yet.</p>
        )}
        {latest?.status === "failed" && <p className="text-red-700 dark:text-red-400">The last scan failed: {latest.error}</p>}
      </div>

      {!active && (
        <ActionForm action={scanAction} successMessage="Scan asked for. It starts within a minute.">
          <div>
            <SubmitButton>Scan now</SubmitButton>
          </div>
        </ActionForm>
      )}

      {early.length > 0 && (
        <p className="rounded-md border border-red-700 p-3 text-sm text-red-700 dark:border-red-400 dark:text-red-400">
          {early.length === 1 ? "One optional item was" : `${early.length} optional items were`} set before the visitor
          chose, which the law does not allow: {early.map((item) => item.name).join(", ")}. Optional cookies must wait for
          consent.
        </p>
      )}
      {undescribed.length > 0 && (
        <p className="text-sm">
          {undescribed.length === 1 ? "One item Kaizen does not know needs" : `${undescribed.length} items Kaizen does not know need`}{" "}
          a description before the cookie page lists {undescribed.length === 1 ? "it" : "them"}.
          {noteAction ? "" : " An owner can describe them."}
        </p>
      )}

      {lastDone && findings.length === 0 && (
        <p className="text-sm text-muted">Nothing was stored in the browser on the pages the scan opened.</p>
      )}
      {findings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="py-2 pr-4 font-normal">Item</th>
                <th scope="col" className="py-2 pr-4 font-normal">Found</th>
                <th scope="col" className="py-2 pr-4 font-normal">Lasts</th>
                <th scope="col" className="py-2 font-normal">What it is</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((item) => (
                <tr key={`${item.kind}|${item.domain}|${item.name}`} className="border-b border-border align-top last:border-0">
                  <td className="py-2 pr-4">
                    <span className="font-mono text-xs break-all">{item.name}</span>
                    <span className="block text-xs text-muted">
                      {KINDS[item.kind]} · {item.domain}
                      {item.thirdParty ? " (another service)" : ""}
                    </span>
                  </td>
                  <td className={`py-2 pr-4 ${item.problem === "early" ? "font-medium text-red-700 dark:text-red-400" : ""}`}>
                    {item.beforeConsent ? "Before a choice" : "Once allowed"}
                    <span className="block text-xs font-normal text-muted">{item.page}</span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {item.kind !== "cookie" ? "Until cleared" : item.days === null ? "Until the browser closes" : `${item.days} days`}
                  </td>
                  <td className="py-2">
                    <Description item={item} />
                    {noteAction && !item.known && <NoteForm item={item} action={noteAction} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
