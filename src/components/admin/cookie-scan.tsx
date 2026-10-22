import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { legalEn, type LegalMessages } from "@/lib/admin-messages/legal.en";
import { CONSENT_CATEGORIES } from "@/lib/cookie-consent";
import type { ReviewedItem } from "@/lib/cookie-scan";
import type { CookieScan } from "@/server/cookie-scans";

import { RefreshWhile } from "./refresh-while";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";
const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";
const label = "flex flex-col gap-1 text-sm font-medium";

/** The language a known cookie's purpose is shown in: the admin's, when the cookie has it. */
type PurposeLang = "en" | "nb" | "sv" | "da";

/** Says what an item is: its category and purpose, from Kaizen or the owner. */
function Description({ item, words, purposeLang }: { item: ReviewedItem; words: LegalMessages; purposeLang: PurposeLang }) {
  const w = words.cookies;
  if (item.note) {
    return (
      <>
        <span className="font-medium">{w.categories[item.note.category]}</span> · {item.note.provider}: {item.note.purpose}{" "}
        <span className="text-muted">{w.scan.yours}</span>
      </>
    );
  }
  if (item.known) {
    return (
      <>
        <span className="font-medium">{w.categories[item.known.category]}</span> · {item.known.provider}: {item.known.purpose[purposeLang]}
      </>
    );
  }
  return <span className="font-medium text-danger-text">{w.scan.notDescribed}</span>;
}

/** The owner's description of an item Kaizen does not know, or a change to it. */
function NoteForm({ item, action, words }: { item: ReviewedItem; action: Action; words: LegalMessages }) {
  const w = words.cookies.scan;
  return (
    <details className="mt-2">
      <summary className="w-fit cursor-pointer text-sm underline">
        {item.note ? w.change : w.describe}
        <span className="sr-only">: {item.name}</span>
      </summary>
      <ActionForm action={action} className="mt-3 flex max-w-lg flex-col gap-3" successMessage={w.noteSaved}>
        <input type="hidden" name="kind" value={item.kind} />
        <input type="hidden" name="name" value={item.name} />
        <input type="hidden" name="domain" value={item.domain} />
        <label className={label}>
          {w.forWhat}
          <select name="category" defaultValue={item.note?.category ?? ""} required className={input}>
            <option value="" disabled>
              {w.choose}
            </option>
            {CONSENT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {words.cookies.categories[category]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {w.setBy}
          <input name="provider" defaultValue={item.note?.provider ?? ""} required maxLength={100} placeholder={w.setByPlaceholder} className={input} />
        </label>
        <label className={label}>
          {w.purpose}
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
          <SubmitButton>{w.saveNote}</SubmitButton>
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
  words = legalEn,
  locale = "en-GB",
  purposeLang = "en",
}: {
  scans: CookieScan[];
  lastDone: CookieScan | null;
  findings: ReviewedItem[];
  scanAction: Action;
  noteAction: Action | null;
  /** The words, in the account's language (D312 A8); English unless given. */
  words?: LegalMessages;
  /** How dates are written; en-GB unless given. */
  locale?: string;
  /** The language a known cookie's purpose is shown in; English unless given. */
  purposeLang?: PurposeLang;
}) {
  const w = words.cookies.scan;
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const latest = scans[0] ?? null;
  const active = latest && (latest.status === "queued" || latest.status === "running") ? latest : null;
  const early = findings.filter((item) => item.problem === "early");
  const undescribed = findings.filter((item) => item.problem === "undescribed");
  return (
    <section aria-labelledby="scan-heading" className={card}>
      <div>
        <h2 id="scan-heading" className="text-title text-ink">
          {w.title}
        </h2>
        <p className="text-sm text-muted">{w.text}</p>
      </div>

      <div className="flex flex-col gap-1 text-sm" role="status">
        {active ? (
          <p>
            {active.status === "queued" ? w.queued : w.running}
            <RefreshWhile seconds={5} />
          </p>
        ) : null}
        {lastDone ? (
          <p>
            {fillWords(w.last, {
              date: date.format(new Date(lastDone.finishedAt ?? lastDone.createdAt)),
              pages: countWords(lastDone.pages.length, w.pages),
              items: countWords(lastDone.items.length, w.items),
            })}
          </p>
        ) : (
          !active && <p>{w.never}</p>
        )}
        {latest?.status === "failed" && <p className="text-danger-text">{fillWords(w.failed, { error: latest.error ?? "" })}</p>}
      </div>

      {!active && (
        <ActionForm action={scanAction} successMessage={w.asked}>
          <div>
            <SubmitButton>{w.now}</SubmitButton>
          </div>
        </ActionForm>
      )}

      {early.length > 0 && (
        <p className="rounded-md border border-danger-text p-3 text-sm text-danger-text">
          {countWords(early.length, w.early, { names: early.map((item) => item.name).join(", ") })}
        </p>
      )}
      {undescribed.length > 0 && (
        <p className="text-sm">
          {countWords(undescribed.length, w.undescribed)}
          {noteAction ? "" : w.ownerCan}
        </p>
      )}

      {lastDone && findings.length === 0 && (
        <p className="text-sm text-muted">{w.nothing}</p>
      )}
      {findings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="py-2 pr-4 font-normal">{w.item}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{w.found}</th>
                <th scope="col" className="py-2 pr-4 font-normal">{w.lasts}</th>
                <th scope="col" className="py-2 font-normal">{w.whatItIs}</th>
              </tr>
            </thead>
            <tbody>
              {findings.map((item) => (
                <tr key={`${item.kind}|${item.domain}|${item.name}`} className="border-b border-line align-top last:border-0">
                  <td className="py-2 pr-4">
                    <span className="font-mono text-xs break-all">{item.name}</span>
                    <span className="block text-xs text-muted">
                      {w.kinds[item.kind]} · {item.domain}
                      {item.thirdParty ? w.otherService : ""}
                    </span>
                  </td>
                  <td className={`py-2 pr-4 ${item.problem === "early" ? "font-medium text-danger-text " : ""}`}>
                    {item.beforeConsent ? w.before : w.once}
                    <span className="block text-xs font-normal text-muted">{item.page}</span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {item.kind !== "cookie" ? w.untilCleared : item.days === null ? w.session : countWords(item.days, w.days)}
                  </td>
                  <td className="py-2">
                    <Description item={item} words={words} purposeLang={purposeLang} />
                    {noteAction && !item.known && <NoteForm item={item} action={noteAction} words={words} />}
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
