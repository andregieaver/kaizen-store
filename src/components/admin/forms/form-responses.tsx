"use client";

import { Archive, Download, Mail, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import type { FormResponseRow } from "@/server/forms-admin";

import { useAdminLang, useAdminText } from "../admin-text";
import { adminDate } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { fileSize } from "@/lib/form-files";
import { AdminLink } from "../ui/link";
import { Button, ButtonLink, Card, Chip } from "../ui";

/**
 * A form's responses (D705): newest first, a new one marked until it is opened; each opens to its answers with a reply by email when it has
 * an address, and can be archived or deleted. The export is the page's own POST (the CSV holds people's words, never cached).
 */
export function FormResponses({
  responses,
  archived,
  more,
  base,
  exportAction,
  setState,
  remove,
  timeZone,
}: {
  responses: FormResponseRow[];
  archived: boolean;
  more: string | null;
  /** The form's responses page, `?archived=1` for the archived ones. */
  base: string;
  exportAction: string;
  setState: (ids: string[], state: FormResponseRow["state"]) => Promise<number>;
  remove: (ids: string[]) => Promise<number>;
  /** The store's time zone, or the platform's for Kaizena Flow's own forms: when each response came, on that clock (D812). */
  timeZone: string;
}) {
  const w = useAdminText("forms").responses;
  const lang = useAdminLang();
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // The actions refresh the page themselves.
  const run = (job: () => Promise<unknown>) => start(async () => void (await job()));

  return (
    <div className="flex flex-col gap-4" data-form-responses>
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex gap-2 text-sm" aria-label={w.showOpen}>
          <a href={base} aria-current={!archived ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium">
            {w.showOpen}
          </a>
          <a href={`${base}?archived=1`} aria-current={archived ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-card aria-[current=page]:font-medium">
            {w.showArchived}
          </a>
        </nav>
        <form method="post" action={exportAction} className="ml-auto">
          <Button type="submit" icon={<Download aria-hidden className="size-4" />} data-form-export>
            {w.export}
          </Button>
        </form>
      </div>
      {responses.length === 0 ? (
        <Card>
          <p className="text-body text-ink-2">{archived ? w.noneArchived : w.none}</p>
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {responses.map((r) => {
            const isOpen = open === r.id;
            const first = r.answers.find((a) => a.value.trim())?.value ?? "";
            return (
              <li key={r.id} className="rounded-panel bg-card dark:border dark:border-line" data-response={r.id}>
                <button
                  type="button"
                  className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left"
                  aria-expanded={isOpen}
                  onClick={() => {
                    setOpen(isOpen ? null : r.id);
                    if (!isOpen && r.state === "new") run(() => setState([r.id], "read"));
                  }}
                >
                  <span className={`min-w-0 flex-1 truncate ${r.state === "new" ? "text-body-strong text-ink" : "text-body text-ink-2"}`}>{r.contactEmail ?? first}</span>
                  {r.state === "new" && (
                    <Chip signal="insight" dot>
                      {w.fresh}
                    </Chip>
                  )}
                  {r.payment?.state === "paid" && (
                    <Chip signal="positive" data-response-paid>
                      {fillWords(w.paid, { number: r.payment.number })}
                    </Chip>
                  )}
                  {r.payment?.state === "waiting" && <Chip data-response-unpaid>{w.unpaid}</Chip>}
                  {r.delivery === "failed" && <Chip signal="warning">{w.emailFailed}</Chip>}
                  <span className="shrink-0 text-caption text-muted tabular-nums">{adminDate(timeZone, r.createdAt, "dayTime", lang)}</span>
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
                    <dl className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                      {r.answers.map((a, i) => (
                        <div key={i} className="contents">
                          <dt className="text-caption text-muted">{a.label}</dt>
                          <dd className="whitespace-pre-wrap break-words text-body text-ink">{a.value}</dd>
                        </div>
                      ))}
                      <dt className="text-caption text-muted">{w.page}</dt>
                      <dd className="break-all text-body text-ink-2">{r.path}</dd>
                    </dl>
                    {r.files.length > 0 && (
                      <ul className="flex flex-wrap gap-2" aria-label={w.files} data-response-files>
                        {r.files.map((f) => (
                          <li key={f.question}>
                            {/* A download only: the file is a visitor's, never shown on an admin page (D738 F6b). */}
                            <a
                              href={`${base}/files/${r.id}/${f.question}`}
                              download
                              className="inline-flex min-h-11 items-center gap-2 rounded-panel border border-line px-3 text-body text-ink hover:bg-sunken"
                            >
                              <Download aria-hidden className="size-4" />
                              <span className="max-w-64 truncate">{f.name}</span>
                              <span className="text-caption text-muted">{fileSize(f.bytes)}</span>
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    {r.delivery === "inbox" && <p className="text-caption text-muted">{w.inbox}</p>}
                    {r.payment?.state === "paid" && (
                      // The order is the store's own (F6c): its payment, invoice and VAT are there.
                      <AdminLink href={`${base.split("/forms/")[0]}/orders/${r.payment.orderId}`} className="text-body text-ink underline" data-response-order>
                        {fillWords(w.openOrder, { number: r.payment.number })}
                      </AdminLink>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {r.contactEmail && (
                        <ButtonLink href={`mailto:${r.contactEmail}`} icon={<Mail aria-hidden className="size-4" />}>
                          {w.reply}
                        </ButtonLink>
                      )}
                      <Button disabled={pending} onClick={() => run(() => setState([r.id], r.state === "archived" ? "read" : "archived"))} icon={<Archive aria-hidden className="size-4" />}>
                        {r.state === "archived" ? w.unarchive : w.archive}
                      </Button>
                      {r.state !== "new" && r.state !== "archived" && (
                        <Button kind="quiet" disabled={pending} onClick={() => run(() => setState([r.id], "new"))}>
                          {w.markNew}
                        </Button>
                      )}
                      <Button
                        kind="link"
                        disabled={pending}
                        icon={<Trash2 aria-hidden className="size-4" />}
                        onClick={() => {
                          if (window.confirm(w.deleteConfirm)) run(() => remove([r.id]));
                        }}
                      >
                        {w.delete}
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {more && (
        <ButtonLink href={more} kind="quiet">
          {w.more}
        </ButtonLink>
      )}
    </div>
  );
}
