"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useTransition } from "react";

import { useAdminText } from "@/components/admin/admin-text";
import { CARD_CLASS } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { SLOT_LIMITS, templateProblems, type EmailTemplate, type TemplateProblem, type TemplateSlot } from "@/lib/email-template";
import { notificationOf, type PlaceholderName } from "@/lib/notifications";

export type EditorLanguage = {
  lang: string;
  /** "Norwegian Bokmål". */
  label: string;
  /** The store offers it now; a language only kept is read-only with *Delete*. */
  offered: boolean;
  /** The store's saved words in it, or null (the standard text). */
  saved: EmailTemplate | null;
  /** The standard text of each slot in it, filled with the sample order: each field's placeholder. */
  standard: { subject: string; heading: string; intro: string };
};

export type EditorPreview = { subject: string; html: string };

type PreviewResult = { ok: true; subject: string; html: string; problems: TemplateProblem[] } | { ok: false; message: string };
type SaveResult = { ok: true; message: string; deleted: boolean } | { ok: false; message: string; problems: TemplateProblem[] };
type Said = { ok: boolean; message: string };

export type EditorActions = {
  preview: (lang: string, draft: EmailTemplate | null) => Promise<PreviewResult>;
  /** Null when the person may not change settings. */
  save: ((lang: string, draft: EmailTemplate) => Promise<SaveResult>) | null;
  reset: ((lang: string) => Promise<Said>) | null;
  test: ((lang: string, draft: EmailTemplate | null) => Promise<Said>) | null;
};

type Draft = Record<TemplateSlot, string>;
const draftOf = (t: EmailTemplate | null): Draft => ({ subject: t?.subject ?? "", heading: t?.heading ?? "", body: t?.body ?? "" });
const asTemplate = (d: Draft): EmailTemplate => ({ subject: d.subject, heading: d.heading, body: d.body });
const same = (a: Draft, b: Draft) => a.subject === b.subject && a.heading === b.heading && a.body === b.body;

const field = "w-full rounded-md border border-line bg-card px-3 py-2 text-sm font-normal";
const label = "flex flex-col gap-1 text-sm font-medium";
const hint = "text-xs font-normal text-muted";
const pill = "min-h-10 rounded-pill border border-edge bg-card px-4 text-sm disabled:opacity-45";
const mainPill = "min-h-10 rounded-pill bg-brand px-5 text-sm font-medium text-brand-ink disabled:opacity-45";


/**
 * One customer email's editor (wave 3, D238, `docs/wave-3-notifications.md` 2.1 points 2 to 6): per language of the store the subject, the heading and
 * the text, each showing the standard text (filled with the sample order) as its placeholder, so an empty field means "standard text"; the
 * notification's placeholders as chips that go in at the cursor; the problems `templateProblems()` finds as the owner types (the server checks again and
 * refuses to save while there is one); a preview drawn by the server with the sample order; a test email to oneself; *Use standard text*. The withdrawal
 * acknowledgement is shown, never edited.
 */
export function NotificationEditor({
  id,
  languages,
  initialLang,
  initialPreview,
  actions,
}: {
  id: string;
  languages: EditorLanguage[];
  initialLang: string;
  initialPreview: EditorPreview | null;
  actions: EditorActions;
}) {
  const router = useRouter();
  const uid = useId();
  const all = useAdminText("notifications");
  const w = all.editor;
  const def = notificationOf(id);
  const [lang, setLang] = useState(languages.some((l) => l.lang === initialLang) ? initialLang : (languages[0]?.lang ?? initialLang));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(languages.map((l) => [l.lang, draftOf(l.saved)])));
  const [preview, setPreview] = useState<EditorPreview | null>(initialPreview);
  const [previewLang, setPreviewLang] = useState(initialLang);
  const [serverProblems, setServerProblems] = useState<TemplateProblem[]>([]);
  const [message, setMessage] = useState<Said | null>(null);
  const [busy, start] = useTransition();
  const focused = useRef<{ slot: TemplateSlot; el: HTMLInputElement | HTMLTextAreaElement } | null>(null);

  const language = languages.find((l) => l.lang === lang) ?? languages[0];
  const editable = Boolean(def?.editable);
  const writable = editable && Boolean(actions.save) && Boolean(language?.offered);
  const draft = drafts[lang] ?? draftOf(null);
  const saved = draftOf(language?.saved ?? null);
  const changed = !same(draft, saved);
  const problems = useMemo(() => (editable ? templateProblems(asTemplate(draft), id, w.problems) : []), [draft, editable, id, w.problems]);
  /** The server's problems (written in English) said again in the person's words, found by slot, kind and detail among the draft's own. */
  const ownWords = (p: TemplateProblem) => problems.find((q) => q.slot === p.slot && q.code === p.code && q.detail === p.detail)?.message ?? p.message;
  const shownProblems = problems.length > 0 ? problems : serverProblems.map((p) => ({ ...p, message: ownWords(p) }));

  if (!def || !language) return <p className="text-sm text-muted">{w.cannotShow}</p>;

  const setSlot = (slot: TemplateSlot, value: string) => {
    setDrafts((all) => ({ ...all, [lang]: { ...(all[lang] ?? draftOf(null)), [slot]: value } }));
    setServerProblems([]);
    setMessage(null);
  };

  const insert = (name: PlaceholderName) => {
    const target = focused.current;
    const token = `{${name}}`;
    if (!target) {
      setSlot("body", `${draft.body}${draft.body && !draft.body.endsWith(" ") ? " " : ""}${token}`);
      return;
    }
    const { slot, el } = target;
    const value = draft[slot];
    const from = el.selectionStart ?? value.length;
    const to = el.selectionEnd ?? value.length;
    setSlot(slot, `${value.slice(0, from)}${token}${value.slice(to)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(from + token.length, from + token.length);
    });
  };

  const runPreview = () =>
    start(async () => {
      const answer = await actions.preview(lang, editable ? asTemplate(draft) : null);
      if (answer.ok) {
        setPreview({ subject: answer.subject, html: answer.html });
        setPreviewLang(lang);
        setServerProblems(answer.problems);
      } else setMessage({ ok: false, message: answer.message });
    });

  const save = () =>
    start(async () => {
      if (!actions.save) return;
      const answer = await actions.save(lang, asTemplate(draft));
      setMessage({ ok: answer.ok, message: answer.message });
      if (answer.ok) {
        router.refresh();
        runPreviewAfter();
      } else setServerProblems(answer.problems);
    });

  const runPreviewAfter = () => {
    void actions.preview(lang, editable ? asTemplate(draft) : null).then((answer) => {
      if (answer.ok) {
        setPreview({ subject: answer.subject, html: answer.html });
        setPreviewLang(lang);
      }
    });
  };

  const reset = () => {
    if (!actions.reset) return;
    if (!window.confirm(fillWords(w.resetQuestion, { language: language.label }))) return;
    start(async () => {
      const answer = await actions.reset!(lang);
      setMessage(answer);
      if (answer.ok) {
        setDrafts((all) => ({ ...all, [lang]: draftOf(null) }));
        router.refresh();
      }
    });
  };

  const test = () =>
    start(async () => {
      if (!actions.test) return;
      setMessage(await actions.test(lang, editable ? asTemplate(draft) : null));
    });

  const placeholders = def.placeholders;
  const problemsOf = (slot: TemplateSlot) => shownProblems.filter((p) => p.slot === slot);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        {languages.length > 1 && (
          <div role="radiogroup" aria-label={w.language} className="flex flex-wrap gap-2">
            {languages.map((l) => (
              <button
                key={l.lang}
                type="button"
                role="radio"
                aria-checked={l.lang === lang}
                onClick={() => {
                  setLang(l.lang);
                  setServerProblems([]);
                  setMessage(null);
                }}
                className={`min-h-10 rounded-pill px-4 text-sm ${l.lang === lang ? "bg-inverse text-inverse-ink" : "border border-edge bg-card"}`}
              >
                {l.label}
                {l.saved ? w.yourTextMark : ""}
                {!l.offered ? w.notOfferedMark : ""}
              </button>
            ))}
          </div>
        )}

        {!editable ? (
          <section className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
            {id === "gift_card.issued" ? (
              <p className="text-sm">{w.lockedGiftCard}</p>
            ) : (
              <>
                <p className="text-sm">{w.locked}</p>
                <p className={hint}>{w.lockedHint}</p>
              </>
            )}
          </section>
        ) : (
          <section aria-labelledby={`${uid}-words`} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
            <h2 id={`${uid}-words`} className="text-title text-ink">
              {languages.length > 1 ? fillWords(w.yourWordsIn, { language: language.label }) : w.yourWords}
            </h2>
            {!language.offered && (
              <p className="rounded-md border border-line bg-sunken p-3 text-sm">
                {fillWords(w.notOfferedNote, { language: language.label })}
              </p>
            )}
            {(["subject", "heading", "body"] as const).map((slot) => {
              const standard = slot === "body" ? language.standard.intro : language.standard[slot];
              const slotProblems = problemsOf(slot);
              const errorId = `${uid}-${slot}-problems`;
              const common = {
                id: `${uid}-${slot}`,
                name: slot,
                value: draft[slot],
                placeholder: standard,
                readOnly: !writable,
                maxLength: SLOT_LIMITS[slot] + 200,
                "aria-invalid": slotProblems.length > 0 ? true : undefined,
                "aria-describedby": slotProblems.length > 0 ? errorId : undefined,
                onFocus: (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
                  focused.current = { slot, el: e.currentTarget };
                },
                className: slot === "body" ? `${field} min-h-40` : `${field} min-h-10`,
              };
              return (
                <div key={slot} className="flex flex-col gap-1">
                  <label htmlFor={common.id} className={label}>
                    <span>
                      {w.slots[slot]}{" "}
                      <span className="font-normal text-muted">{fillWords(w.count, { n: [...draft[slot]].length, max: SLOT_LIMITS[slot] })}</span>
                    </span>
                  </label>
                  {slot === "body" ? (
                    <textarea {...common} onChange={(e) => setSlot(slot, e.target.value)} rows={6} />
                  ) : (
                    <input {...common} type="text" onChange={(e) => setSlot(slot, e.target.value)} />
                  )}
                  {slotProblems.length > 0 && (
                    <ul id={errorId} className="list-disc pl-5 text-sm text-danger-text">
                      {slotProblems.map((p, i) => (
                        <li key={`${p.code}-${i}`}>{p.message}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium">{w.placeholders}</p>
              <ul className="flex flex-wrap gap-2" aria-label={w.placeholders}>
                {placeholders.map((name) => (
                  <li key={name}>
                    <button type="button" disabled={!writable} onClick={() => insert(name)} title={w.placeholderLabels[name]} className="min-h-9 rounded-pill border border-edge bg-card px-3 font-mono text-xs disabled:opacity-45">
                      {`{${name}}`}
                    </button>
                    <span className="sr-only">: {w.placeholderLabels[name]}</span>
                  </li>
                ))}
              </ul>
              <ul className={`${hint} list-disc pl-5`}>
                {placeholders.map((name) => (
                  <li key={name}>
                    <code>{`{${name}}`}</code>: {w.placeholderLabels[name]}
                  </li>
                ))}
              </ul>
            </div>
            <p className={hint}>{w.howHint}</p>
            <p className={hint}>{w.addsHint}</p>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {writable && (
            <button type="button" onClick={save} disabled={busy || !changed || problems.length > 0} className={mainPill}>
              {busy ? all.common.working : all.common.save}
            </button>
          )}
          <button type="button" onClick={runPreview} disabled={busy} className={pill}>
            {w.preview}
          </button>
          {actions.test && (
            <button type="button" onClick={test} disabled={busy || problems.length > 0} className={pill}>
              {w.sendTest}
            </button>
          )}
          {editable && actions.reset && language.saved && (
            <button type="button" onClick={reset} disabled={busy} className={pill}>
              {language.offered ? w.useStandard : w.delete}
            </button>
          )}
        </div>
        {problems.length > 0 && writable && <p className="text-sm text-danger-text">{w.blocked}</p>}
        {!actions.save && editable && <p className="text-sm text-muted">{w.readOnly}</p>}
        <p role="status" aria-live="polite" className={`text-sm empty:hidden ${message && !message.ok ? "text-danger-text" : ""}`}>
          {message?.message}
        </p>
      </div>

      <section aria-labelledby={`${uid}-preview`} className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <h2 id={`${uid}-preview`} className="text-title text-ink">
          {languages.length > 1 ? fillWords(w.previewIn, { language: languages.find((l) => l.lang === previewLang)?.label ?? previewLang }) : w.preview}
        </h2>
        <p className={hint}>{w.previewHint}</p>
        {preview ? (
          <div className={`overflow-hidden ${CARD_CLASS}`}>
            <p className="border-b border-line px-4 py-2 text-sm">
              <span className="text-muted">{w.subjectLabel}</span> {preview.subject}
            </p>
            <iframe title={w.frameTitle} srcDoc={preview.html} sandbox="" className="h-[40rem] w-full bg-card" />
          </div>
        ) : (
          <p className="text-sm text-muted">{w.noPreview}</p>
        )}
      </section>
    </div>
  );
}
