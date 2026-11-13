"use client";

import Link from "next/link";
import { useState } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { Button, Card, Chip } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { dnsRecordFor, embedTag } from "@/lib/support-embed";
import type { SupportEmbed } from "@/server/support-embeds";

import { useAdminText } from "../admin-text";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

const field = "w-full rounded-md border border-line bg-card px-2 py-1.5 text-sm";

/** A line to copy: the text in a box that selects itself, and a button that copies it. */
function CopyLine({ text, label }: { text: string; label: string }) {
  const w = useAdminText("support").embed;
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
 * The desk's chat on websites of the owner's own (D581, `docs/support-embed.md`): Homer types his website's address and pastes the tag
 * it gives him; the site says Live once the tag is found. Lisa's parts (the privacy page, the language, the DNS record for a tag manager)
 * are there but folded away.
 */
export function SupportEmbedsCard({
  embeds,
  origin,
  add,
  check,
  remove,
  markets,
  chatOn,
  knowledgeHref,
}: {
  embeds: SupportEmbed[];
  /** Kaizena Flow's own origin, where the tag's loader is. */
  origin: string;
  add: Action | null;
  check: Action | null;
  remove: Action | null;
  /** A store's countries for the chat's language there (slug, name); null on Kaizena Flow's desk. */
  markets: { slug: string; name: string }[] | null;
  /** Whether the desk shows a chat at all (support or the assistant on). */
  chatOn: boolean;
  knowledgeHref: string;
}) {
  const w = useAdminText("support").embed;
  return (
    <Card title={w.title} description={w.description}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {w.knowledge}{" "}
          <Link href={knowledgeHref} className="underline">
            {w.knowledgeLink}
          </Link>
        </p>
        {!chatOn && (
          <p role="status" className="rounded-panel border border-warning-line bg-warning-soft px-3 py-2 text-sm text-warning-text">
            {w.chatOff}
          </p>
        )}
        {embeds.length > 0 && (
          <ul className="flex flex-col gap-3">
            {embeds.map((embed) => (
              <li key={embed.id} className="flex flex-col gap-3 rounded-panel border border-line p-4" data-embed={embed.host}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium break-all">{embed.host}</span>
                  {embed.verifiedAt ? (
                    <Chip signal="positive" dot>
                      {w.live}
                    </Chip>
                  ) : (
                    <Chip signal="warning" dot>
                      {w.waiting}
                    </Chip>
                  )}
                </div>
                {embed.verifiedAt
                  ? embed.verifiedBy && <p className="text-sm text-muted">{w.foundBy[embed.verifiedBy]}</p>
                  : embed.checkProblem && <p className="text-sm text-muted">{fillWords(w.checkProblem[embed.checkProblem], { host: embed.host })}</p>}
                <div className="flex flex-col gap-2">
                  {!embed.verifiedAt && <p className="text-sm">{w.pasteTag}</p>}
                  <CopyLine text={embedTag(origin, embed.key)} label={w.title} />
                </div>
                {!embed.verifiedAt && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-muted">{w.tagManager}</summary>
                    <div className="mt-2 flex flex-col gap-2">
                      <p className="text-muted">{fillWords(w.dnsRecord, { host: embed.host })}</p>
                      <CopyLine text={dnsRecordFor(embed.key)} label={w.tagManager} />
                    </div>
                  </details>
                )}
                {(check || remove) && (
                  <div className="flex flex-wrap gap-2">
                    {check && !embed.verifiedAt && (
                      <ActionForm action={check} successMessage={w.checkedLive}>
                        <input type="hidden" name="id" value={embed.id} />
                        <SubmitButton variant="secondary" skipValidation>
                          {w.check}
                        </SubmitButton>
                      </ActionForm>
                    )}
                    {remove && (
                      <ActionForm action={remove} successMessage={w.removed}>
                        <input type="hidden" name="id" value={embed.id} />
                        <SubmitButton variant="secondary" skipValidation>
                          {w.remove}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {add && (
          <ActionForm action={add} successMessage={w.added}>
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-sm font-medium">
                {w.host}
                <input name="host" required autoComplete="off" inputMode="url" placeholder={w.hostPlaceholder} className={field} />
              </label>
              <details className="text-sm">
                <summary className="cursor-pointer text-muted">
                  {w.privacy}
                  {markets && markets.length > 1 ? ` · ${w.market}` : ""}
                </summary>
                <div className="mt-2 flex flex-col gap-3">
                  <label className="flex flex-col gap-1 font-medium">
                    {w.privacy}
                    <input name="privacy" type="url" autoComplete="off" placeholder={w.privacyPlaceholder} className={field} />
                  </label>
                  {markets && markets.length > 1 && (
                    <label className="flex flex-col gap-1 font-medium">
                      {w.market}
                      <select name="market" defaultValue={markets[0]?.slug} className={field}>
                        {markets.map((market) => (
                          <option key={market.slug} value={market.slug}>
                            {market.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              </details>
              <div>
                <SubmitButton>{w.add}</SubmitButton>
              </div>
            </div>
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
