"use client";

import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Button, Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { dnsRecordFor, embedTag } from "@/lib/support-embed";
import type { SupportWidget } from "@/server/support-widgets";

import { useAdminText } from "../../admin-text";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const field = "w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm";

/** A line to copy: the text in a box that selects itself, and a button that copies it. */
export function CopyLine({ text, label }: { text: string; label: string }) {
  const w = useAdminText("support").widgets;
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-start gap-2">
      <code aria-label={label} className="min-w-0 flex-1 select-all break-all rounded-panel bg-sunken px-3 py-2 text-xs text-ink">
        {text}
      </code>
      <Button
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? w.copied : w.copy}
      </Button>
    </div>
  );
}

/**
 * A widget's tag and its websites (D581): the one tag to paste on each, every site with whether its tag was found (Live) and why not,
 * *Check now* and *Remove*, and a site added by its address. For a tag a tag manager adds, the DNS record is one step away.
 */
export function WidgetSites({ widget, origin, add, check, remove }: { widget: SupportWidget; origin: string; add: Action | null; check: Action | null; remove: Action | null }) {
  const w = useAdminText("support").widgets;
  const waiting = widget.sites.some((site) => !site.verifiedAt);
  return (
    <Card title={w.sites} description={w.sitesHint}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">{w.tag}</p>
          <p className="text-sm text-muted">{w.tagHint}</p>
          <CopyLine text={embedTag(origin, widget.key)} label={w.tag} />
          {(waiting || widget.sites.length === 0) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted">{w.tagManager}</summary>
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-muted">{w.dnsRecord}</p>
                <CopyLine text={dnsRecordFor(widget.key)} label={w.tagManager} />
              </div>
            </details>
          )}
        </div>
        {widget.sites.length > 0 && (
          <ul className="flex flex-col gap-2">
            {widget.sites.map((site) => (
              <li key={site.id} data-site={site.host} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-panel border border-line px-4 py-3">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium break-all">{site.host}</span>
                    {site.verifiedAt ? (
                      <Chip signal="positive" dot>
                        {w.live}
                      </Chip>
                    ) : (
                      <Chip signal="warning" dot>
                        {w.waiting}
                      </Chip>
                    )}
                  </span>
                  <span className="text-sm text-muted">
                    {site.verifiedAt
                      ? site.verifiedBy && w.foundBy[site.verifiedBy]
                      : site.checkProblem && fillWords(w.checkProblem[site.checkProblem], { host: site.host })}
                  </span>
                </span>
                <span className="flex flex-wrap gap-2">
                  {check && !site.verifiedAt && (
                    <ActionForm action={check} successMessage={w.checkedLive}>
                      <input type="hidden" name="id" value={site.id} />
                      <SubmitButton variant="secondary" skipValidation>
                        {w.check}
                      </SubmitButton>
                    </ActionForm>
                  )}
                  {remove && (
                    <ActionForm action={remove} successMessage={w.removed}>
                      <input type="hidden" name="id" value={site.id} />
                      <SubmitButton variant="secondary" skipValidation>
                        {w.remove}
                      </SubmitButton>
                    </ActionForm>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {add && (
          <ActionForm action={add} successMessage={w.added}>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm font-medium">
                {w.addSite}
                <input name="host" required autoComplete="off" inputMode="url" placeholder={w.hostPlaceholder} className={field} />
              </label>
              <SubmitButton>{w.addSite}</SubmitButton>
            </div>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
