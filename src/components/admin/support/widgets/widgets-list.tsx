"use client";

import Link from "next/link";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Card, Chip } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";
import type { SupportWidget } from "@/server/support-widgets";

import { useAdminText } from "../../admin-text";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const field = "w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm";

/**
 * A desk's chat widgets (D582): each with its name, its button colour, and how many of its websites show it; and a new one made from a
 * name and, if Homer has it to hand, the website it is for (he is taken to it straight after, to style it and copy its tag).
 */
export function WidgetsList({ widgets, base, create, chatOn, knowledgeHref }: { widgets: SupportWidget[]; base: string; create: Action | null; chatOn: boolean; knowledgeHref: string }) {
  const w = useAdminText("support").widgets;
  return (
    <div className="flex flex-col gap-6">
      {!chatOn && (
        <p role="status" className="rounded-panel border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-text">
          {w.chatOff}
        </p>
      )}
      {widgets.length === 0 ? (
        <p className="text-body text-muted">{w.none}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {widgets.map((widget) => {
            const live = widget.sites.filter((site) => site.verifiedAt).length;
            return (
              <li key={widget.id}>
                <Link href={`${base}/${widget.id}`} className="flex h-full flex-col gap-3 rounded-panel border border-line bg-card p-5 hover:bg-sunken" data-widget={widget.name}>
                  <span className="flex items-center gap-3">
                    <span aria-hidden className="size-8 shrink-0 rounded-full border border-line" style={{ background: widget.style.accent ?? "var(--color-ink, #171717)" }} />
                    <span className="min-w-0 truncate font-medium">{widget.name}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    {widget.sites.length === 0 ? w.noSites : countWords(widget.sites.length, w.sitesCount)}
                    {live > 0 && (
                      <Chip signal="positive" dot>
                        {countWords(live, w.liveCount)}
                      </Chip>
                    )}
                  </span>
                  {widget.sites.length > 0 && <span className="truncate text-sm text-muted">{widget.sites.map((site) => site.host).join(", ")}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {create && (
        <Card title={w.newTitle}>
          <ActionForm action={create}>
            <div className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.name}
                  <input name="name" required maxLength={60} placeholder={w.namePlaceholder} className={field} />
                </label>
                <label className="flex flex-col gap-1 text-sm font-medium">
                  {w.firstSite}
                  <input name="host" autoComplete="off" inputMode="url" placeholder={w.hostPlaceholder} className={field} />
                </label>
              </div>
              <div>
                <SubmitButton>{w.create}</SubmitButton>
              </div>
            </div>
          </ActionForm>
        </Card>
      )}
      <p className="text-sm text-muted">
        {w.knowledge}{" "}
        <Link href={knowledgeHref} className="underline">
          {w.knowledgeLink}
        </Link>
      </p>
    </div>
  );
}
