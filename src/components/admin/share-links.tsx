"use client";

import { Share2 } from "lucide-react";
import { useEffect, useId, useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { PREVIEW_DAY_CHOICES, PREVIEW_DEFAULT_DAYS, type PreviewLinkItem } from "@/lib/preview-links";

import { useAdminLang, useAdminText } from "./admin-text";
import { Modal } from "./modal";
import type { PreviewLinkActions } from "./page-context";
import { Button } from "./ui";

type Noun = "page" | "article" | "theme";

/**
 * A page's or theme's preview links (wave 7 unit F, D340): how long a new one works (a week to start with: Homer presses *Make a link* and
 * copies it), the address shown once with *Copy*, and the links made with until when each works and *Revoke*. The same panel in the
 * builder's *Share* dialog and on an installed theme's page.
 */
export function ShareLinks({ id, noun, actions }: { id: string; noun: Noun; actions: PreviewLinkActions }) {
  const all = useAdminText("schedules");
  const w = all.share;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  const field = useId();
  const [links, setLinks] = useState<PreviewLinkItem[] | null>(null);
  const [days, setDays] = useState<number>(PREVIEW_DEFAULT_DAYS);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    actions.list(id).then((found) => {
      if (live) setLinks(found);
    });
    return () => {
      live = false;
    };
  }, [actions, id]);

  const make = () =>
    start(async () => {
      setCopied(false);
      const answer = await actions.make(id, days);
      if (!answer.ok) return setMessage({ tone: "error", text: answer.problem });
      setLinks(answer.links);
      setMade(answer.url ? new URL(answer.url, window.location.origin).toString() : null);
      setMessage({ tone: "ok", text: answer.message });
    });
  const revoke = (link: string) =>
    start(async () => {
      const answer = await actions.revoke(id, link);
      if (!answer.ok) return setMessage({ tone: "error", text: answer.problem });
      setLinks(answer.links);
      setMessage({ tone: "ok", text: answer.message });
    });
  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made);
      setCopied(true);
    } catch {
      // Without the clipboard the address stays selected in its field to copy by hand.
      (document.getElementById(field) as HTMLInputElement | null)?.select();
    }
  };

  return (
    <div className="flex flex-col gap-4" data-share-links="">
      <p className="text-sm text-muted">{noun === "theme" ? w.introTheme : fillWords(w.intro, { noun: all.nouns[noun] })}</p>
      <div className="flex flex-wrap items-end gap-3">
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">{w.days}</legend>
          <div className="flex flex-wrap gap-3 pt-1">
            {PREVIEW_DAY_CHOICES.map((n) => (
              <label key={n} className="flex items-center gap-1.5 text-sm">
                <input type="radio" name={`${field}-days`} value={n} checked={days === n} onChange={() => setDays(n)} className="size-4" />
                {n === 1 ? w.dayChoice.one : fillWords(w.dayChoice.many, { n })}
              </label>
            ))}
          </div>
        </fieldset>
        <Button kind="main" onClick={make} disabled={busy} data-make-link="">
          {w.make}
        </Button>
      </div>
      {made && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={field} className="text-sm font-medium">
            {w.address}
          </label>
          <div className="flex gap-2">
            <input id={field} readOnly value={made} onFocus={(e) => e.target.select()} className="min-h-10 min-w-0 flex-1 rounded-md border border-line bg-card px-3 font-mono text-sm" data-made-link="" />
            <Button onClick={() => void copy()}>{copied ? w.copied : w.copy}</Button>
          </div>
        </div>
      )}
      <div role="status" aria-live="polite" className="text-sm">
        {message && <p className={message.tone === "error" ? "text-danger-text" : ""}>{message.text}</p>}
      </div>
      {links && links.length === 0 ? (
        <p className="text-sm text-muted">{w.none}</p>
      ) : (
        <ul aria-label={w.listLabel} className="flex flex-col divide-y divide-line">
          {links?.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center gap-3 py-2" data-link-row="">
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm text-ink">
                  {link.revokedAt ? fillWords(w.revoked, { when: when(link.revokedAt) }) : link.live ? fillWords(w.open, { when: when(link.expiresAt) }) : fillWords(w.ranOut, { when: when(link.expiresAt) })}
                </span>
                <span className="text-xs text-muted">
                  {link.by ? fillWords(w.madeBy, { when: when(link.createdAt), name: link.by }) : fillWords(w.madeOn, { when: when(link.createdAt) })}
                </span>
              </div>
              {link.live && (
                <Button kind="quiet" size="dense" onClick={() => revoke(link.id)} disabled={busy}>
                  {w.revoke}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The builder's *Share* (D340): opens the page's or article's preview links in a dialog, once the page has been saved. */
export function ShareButton({ id, noun, actions }: { id: string; noun: "page" | "article"; actions: PreviewLinkActions }) {
  const w = useAdminText("schedules").share;
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-share-button=""
        className="inline-flex min-h-11 items-center gap-2 rounded-pill border border-edge px-4 font-medium"
      >
        <Share2 aria-hidden className="size-4" />
        {w.button}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={w.title} footer={<Button onClick={() => setOpen(false)}>{w.close}</Button>}>
        {open && <ShareLinks id={id} noun={noun} actions={actions} />}
      </Modal>
    </>
  );
}
