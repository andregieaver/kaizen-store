"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useRef, useState, useTransition } from "react";

import { CARD_CLASS } from "@/components/admin/ui";
import { PLACEHOLDERS, SLOT_LIMITS, templateProblems, type EmailTemplate, type TemplateProblem, type TemplateSlot } from "@/lib/email-template";
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

const SLOT_LABELS: Record<TemplateSlot, string> = { subject: "Subject", heading: "Heading", body: "Text" };

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
  const problems = useMemo(() => (editable ? templateProblems(asTemplate(draft), id) : []), [draft, editable, id]);
  const shownProblems = problems.length > 0 ? problems : serverProblems;

  if (!def || !language) return <p className="text-sm text-muted">This email cannot be shown.</p>;

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
    if (!window.confirm(`Delete your own text for ${language.label} and use the standard text?`)) return;
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
          <div role="radiogroup" aria-label="Language" className="flex flex-wrap gap-2">
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
                {l.saved ? " · your text" : ""}
                {!l.offered ? " · not offered" : ""}
              </button>
            ))}
          </div>
        )}

        {!editable ? (
          <section className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
            <p className="text-sm">This email is the legal acknowledgement of a withdrawal and cannot be changed.</p>
            <p className={hint}>It is sent in the customer&apos;s language as soon as they withdraw, and kept as evidence that the withdrawal was received.</p>
          </section>
        ) : (
          <section aria-labelledby={`${uid}-words`} className={`flex flex-col gap-4 p-5 ${CARD_CLASS}`}>
            <h2 id={`${uid}-words`} className="text-title text-ink">
              Your words{languages.length > 1 ? `: ${language.label}` : ""}
            </h2>
            {!language.offered && (
              <p className="rounded-md border border-line bg-sunken p-3 text-sm">
                The store no longer offers {language.label}. These words are kept for orders placed in it, and can be deleted.
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
                      {SLOT_LABELS[slot]}{" "}
                      <span className="font-normal text-muted">
                        ({[...draft[slot]].length} of {SLOT_LIMITS[slot]}; empty is the standard text)
                      </span>
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
              <p className="text-sm font-medium">Placeholders</p>
              <ul className="flex flex-wrap gap-2" aria-label="Placeholders">
                {placeholders.map((name) => (
                  <li key={name}>
                    <button type="button" disabled={!writable} onClick={() => insert(name)} title={PLACEHOLDERS[name].label} className="min-h-9 rounded-pill border border-edge bg-card px-3 font-mono text-xs disabled:opacity-45">
                      {`{${name}}`}
                    </button>
                    <span className="sr-only">: {PLACEHOLDERS[name].label}</span>
                  </li>
                ))}
              </ul>
              <ul className={`${hint} list-disc pl-5`}>
                {placeholders.map((name) => (
                  <li key={name}>
                    <code>{`{${name}}`}</code>: {PLACEHOLDERS[name].label}
                  </li>
                ))}
              </ul>
            </div>
            <p className={hint}>
              A blank line starts a new paragraph. Only the placeholders above are filled in; nothing else is read as code, and web addresses are not allowed
              (the email&apos;s buttons link to the order). This is a message about an order. Do not add offers or advertising: an email that promotes is
              marketing and needs the customer&apos;s consent. The text you write is your responsibility.
            </p>
            <p className={hint}>The order lines, totals, VAT statement, invoice link and the right of withdrawal are always added by Kaizena Flow.</p>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {writable && (
            <button type="button" onClick={save} disabled={busy || !changed || problems.length > 0} className={mainPill}>
              {busy ? "Working …" : "Save"}
            </button>
          )}
          <button type="button" onClick={runPreview} disabled={busy} className={pill}>
            Preview
          </button>
          {actions.test && (
            <button type="button" onClick={test} disabled={busy || problems.length > 0} className={pill}>
              Send a test to me
            </button>
          )}
          {editable && actions.reset && language.saved && (
            <button type="button" onClick={reset} disabled={busy} className={pill}>
              {language.offered ? "Use standard text" : "Delete"}
            </button>
          )}
        </div>
        {problems.length > 0 && writable && <p className="text-sm text-danger-text">Saving is not possible while a field has a problem.</p>}
        {!actions.save && editable && <p className="text-sm text-muted">You can see this email but not change it.</p>}
        <p role="status" aria-live="polite" className={`text-sm empty:hidden ${message && !message.ok ? "text-danger-text" : ""}`}>
          {message?.message}
        </p>
      </div>

      <section aria-labelledby={`${uid}-preview`} className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <h2 id={`${uid}-preview`} className="text-title text-ink">
          Preview{languages.length > 1 ? `: ${languages.find((l) => l.lang === previewLang)?.label ?? previewLang}` : ""}
        </h2>
        <p className={hint}>With a made-up order. Press Preview to see what you typed; the test email sends what you typed to your own address.</p>
        {preview ? (
          <div className={`overflow-hidden ${CARD_CLASS}`}>
            <p className="border-b border-line px-4 py-2 text-sm">
              <span className="text-muted">Subject:</span> {preview.subject}
            </p>
            <iframe title="Email preview" srcDoc={preview.html} sandbox="" className="h-[40rem] w-full bg-card" />
          </div>
        ) : (
          <p className="text-sm text-muted">No preview yet.</p>
        )}
      </section>
    </div>
  );
}
