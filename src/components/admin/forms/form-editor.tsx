"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { SiteForm } from "@/components/site-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import {
  FORM_KEEP_CHOICES,
  formAsBlock,
  newQuestionId,
  type FormDraft,
  type FormQuestion,
  type FormRecord,
  type FormStatus,
  type FormWords,
} from "@/lib/form-records";
import { publicForm } from "@/lib/forms";
import { FORM_FIELDS_MAX, FORM_FIELD_KINDS, FORM_OPTIONS_MAX, FORM_RECIPIENTS_MAX, LABELLED_KINDS, SIGNUP_TAGS_MAX, type FormFieldKind } from "@/lib/page-content";
import { plainWords, type Words } from "@/lib/words";
import type { DeleteFormOutcome, FormUse, SaveFormOutcome } from "@/server/forms-admin";

import { useAdminText } from "../admin-text";
import { Button, Card, CARD_CLASS } from "../ui";

const input = "mt-1 w-full rounded-lg border border-edge bg-card px-3 py-2 text-body text-ink";
const label = "block text-sm";
const labelText = "text-ink-2";
const hint = "mt-1 block text-xs text-muted";

/** Changes the main words, keeping the other languages' (step F3 edits those). */
const withText = (w: Words | undefined, text: string): Words => ({ text, byLocale: w?.byLocale ?? {} });

export type PlacedOn = FormUse & { href: string };

/**
 * The owner's form (D705): what it asks, who it emails and what visitors see after sending, with its preview beside it; how long it keeps
 * responses, its subject and consent one step away under Settings. Saved with the owner's action; archived or deleted from here.
 */
export function FormEditor({
  form,
  siteLang,
  canEdit,
  codes,
  placedOn,
  listHref,
  save,
  setStatus,
  remove,
}: {
  form: FormRecord;
  /** The site's main language: the preview is drawn in it. */
  siteLang: string;
  canEdit: boolean;
  /** A store's discounts with single-use codes for a sign-up's welcome code; null on Kaizena Flow's own forms. */
  codes: { id: string; code: string }[] | null;
  placedOn: PlacedOn[];
  listHref: string;
  save: (draft: FormDraft) => Promise<SaveFormOutcome>;
  setStatus: (status: FormStatus) => Promise<boolean>;
  remove: () => Promise<DeleteFormOutcome>;
}) {
  const w = useAdminText("forms");
  const e = w.editor;
  const router = useRouter();
  const [draft, setDraft] = useState<FormDraft>(() => ({
    kind: form.kind,
    name: form.name,
    questions: form.questions,
    words: form.words,
    delivery: form.delivery,
    signup: form.signup,
    keepMonths: form.keepMonths,
  }));
  const [recipientsText, setRecipientsText] = useState(form.delivery.recipients.join("\n"));
  const [tagsText, setTagsText] = useState((form.signup?.tags ?? []).join(", "));
  const [problems, setProblems] = useState<string[]>([]);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState<null | "delete">(null);
  const [blockedBy, setBlockedBy] = useState<FormUse[] | null>(null);

  const change = (patch: Partial<FormDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
    setSavedAt(null);
  };
  const setWords = (key: keyof FormWords, text: string) => change({ words: { ...draft.words, [key]: withText(draft.words[key], text) } });
  const setQuestion = (i: number, patch: Partial<FormQuestion>) => change({ questions: draft.questions.map((q, n) => (n === i ? { ...q, ...patch } : q)) });
  const moveQuestion = (i: number, by: -1 | 1) => {
    const next = [...draft.questions];
    const [q] = next.splice(i, 1);
    next.splice(i + by, 0, q);
    change({ questions: next });
  };

  const onSave = () =>
    start(async () => {
      const outcome = await save(draft);
      if (outcome.ok) {
        setProblems([]);
        setDirty(false);
        setSavedAt(Date.now());
      } else setProblems(outcome.problems);
    });

  const preview = publicForm(formAsBlock({ id: form.id, ...draft }, siteLang));
  const archived = form.status === "archived";

  return (
    // Side by side only where both fit (the admin's column, not the window); one under the other otherwise, the preview after the form.
    <div className="@container">
    <div className="grid gap-6 @5xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="flex min-w-0 flex-col gap-6">
        {!canEdit && <p className="rounded-panel bg-sunken p-3 text-body text-ink-2">{e.noAccess}</p>}
        {archived && <p className="rounded-panel bg-warning-soft p-3 text-body text-warning-text">{e.archivedNote}</p>}
        <fieldset disabled={!canEdit || pending} className="flex flex-col gap-6">
          <Card>
            <div className="flex flex-col gap-4">
              <label className={label}>
                <span className={labelText}>{e.name}</span>
                <input className={input} value={draft.name} maxLength={80} onChange={(ev) => change({ name: ev.target.value })} data-form-name />
                <span className={hint}>{e.nameHint}</span>
              </label>
              <label className={label}>
                <span className={labelText}>{e.sendTo}</span>
                <textarea
                  className={`${input} min-h-20`}
                  value={recipientsText}
                  placeholder={e.sendToPlaceholder}
                  onChange={(ev) => {
                    setRecipientsText(ev.target.value);
                    const recipients = ev.target.value.split(/[\s,;]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
                    change({ delivery: { ...draft.delivery, recipients } });
                  }}
                  data-form-recipients
                />
                <span className={hint}>{fillWords(e.sendToHint, { max: FORM_RECIPIENTS_MAX })}</span>
              </label>
            </div>
          </Card>

          {draft.kind === "message" ? (
            <Card title={e.questions}>
              <ol className="flex flex-col gap-3" data-form-questions>
                {draft.questions.map((q, i) => (
                  <li key={q.id} className="rounded-panel border border-line p-3">
                    <QuestionFields
                      question={q}
                      first={i === 0}
                      last={i === draft.questions.length - 1}
                      onChange={(patch) => setQuestion(i, patch)}
                      onMove={(by) => moveQuestion(i, by)}
                      onRemove={() => change({ questions: draft.questions.filter((_, n) => n !== i) })}
                    />
                  </li>
                ))}
              </ol>
              {draft.questions.length < FORM_FIELDS_MAX && (
                <Button
                  className="mt-3"
                  icon={<Plus aria-hidden className="size-4" />}
                  onClick={() => change({ questions: [...draft.questions, { id: newQuestionId(draft.questions), kind: "text", label: plainWords("") }] })}
                  data-form-add
                >
                  {e.add}
                </Button>
              )}
            </Card>
          ) : (
            <Card title={e.signup}>
              <div className="flex flex-col gap-4">
                <Tick
                  label={e.doubleOptIn}
                  hint={e.doubleOptInHint}
                  checked={draft.signup?.confirm !== false}
                  onChange={(confirm) => change({ signup: { ...(draft.signup ?? { askName: false, confirm: true }), confirm } })}
                />
                <Tick label={e.askName} checked={Boolean(draft.signup?.askName)} onChange={(askName) => change({ signup: { ...(draft.signup ?? { confirm: true, askName: false }), askName } })} />
                <WordsField label={e.emailHint} value={draft.words.placeholder} placeholder="" hint={e.usual} onChange={(t) => setWords("placeholder", t)} />
              </div>
            </Card>
          )}

          <Card title={e.afterSending}>
            <div className="flex flex-col gap-4">
              <WordsField label={e.buttonText} value={draft.words.submit} hint={e.usual} onChange={(t) => setWords("submit", t)} />
              <WordsField label={e.thanks} value={draft.words.success} hint={e.usual} multiline onChange={(t) => setWords("success", t)} />
            </div>
          </Card>

          <details className={`${CARD_CLASS} p-5`} data-form-settings>
            <summary className="cursor-pointer text-body-strong text-ink">{w.tabs.settings}</summary>
            <div className="mt-4 flex flex-col gap-4">
              {draft.kind === "message" && (
                <label className={label}>
                  <span className={labelText}>{e.subject}</span>
                  <input className={input} value={draft.delivery.subject} maxLength={200} onChange={(ev) => change({ delivery: { ...draft.delivery, subject: ev.target.value } })} />
                  <span className={hint}>{e.subjectHint}</span>
                </label>
              )}
              {draft.kind === "message" ? (
                <>
                  <Tick label={e.consent} checked={draft.words.consent !== undefined} onChange={(on) => change({ words: { ...draft.words, consent: on ? plainWords("") : undefined } })} />
                  {draft.words.consent !== undefined && (
                    <WordsField label={e.consentWords} value={draft.words.consent} placeholder={e.consentPlaceholder} multiline onChange={(t) => setWords("consent", t)} />
                  )}
                </>
              ) : (
                <WordsField label={e.consentWords} value={draft.words.consent} hint={e.usual} multiline onChange={(t) => setWords("consent", t)} />
              )}
              {draft.kind === "signup" && codes && (
                <>
                  <label className={label}>
                    <span className={labelText}>{e.welcomeCode}</span>
                    <select
                      className={input}
                      value={draft.signup?.incentive ?? ""}
                      onChange={(ev) => change({ signup: { ...(draft.signup ?? { confirm: true, askName: false }), incentive: ev.target.value || undefined } })}
                    >
                      <option value="">{e.welcomeCodeNone}</option>
                      {codes.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                    <span className={hint}>{e.welcomeCodeHint}</span>
                  </label>
                  <label className={label}>
                    <span className={labelText}>{e.tags}</span>
                    <input
                      className={input}
                      value={tagsText}
                      onChange={(ev) => {
                        setTagsText(ev.target.value);
                        const tags = ev.target.value.split(",").map((t) => t.trim().slice(0, 40)).filter(Boolean).slice(0, SIGNUP_TAGS_MAX);
                        change({ signup: { ...(draft.signup ?? { confirm: true, askName: false }), tags: tags.length ? tags : undefined } });
                      }}
                    />
                    <span className={hint}>{fillWords(e.tagsHint, { max: SIGNUP_TAGS_MAX })}</span>
                  </label>
                </>
              )}
              <label className={label}>
                <span className={labelText}>{e.keep}</span>
                <select className={input} value={draft.keepMonths} onChange={(ev) => change({ keepMonths: Number(ev.target.value) })} data-form-keep>
                  {FORM_KEEP_CHOICES.map((m) => (
                    <option key={m} value={m}>
                      {countWords(m, e.months)}
                    </option>
                  ))}
                </select>
                <span className={hint}>{e.keepHint}</span>
              </label>
            </div>
          </details>
        </fieldset>

        {problems.length > 0 && (
          <ul role="alert" className="rounded-panel bg-danger-soft p-3 text-body text-danger-text">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-panel bg-card/95 p-3 shadow-md backdrop-blur">
            <Button kind="main" onClick={onSave} disabled={pending || !dirty} data-form-save>
              {pending ? e.saving : e.save}
            </Button>
            {savedAt && (
              <span role="status" className="text-body text-positive-text">
                {e.saved}
              </span>
            )}
          </div>
        )}
      </div>

      <aside className="flex min-w-0 flex-col gap-6 @5xl:sticky @5xl:top-6 @5xl:self-start">
        <Card title={e.preview} description={e.previewNote}>
          <div className="rounded-panel border border-line bg-card p-4 text-ink" data-form-preview>
            <SiteForm form={preview} store={null} lang={siteLang} preview />
          </div>
        </Card>
        <Card title={e.placedOn}>
          {placedOn.length === 0 ? (
            <p className="text-body text-ink-2">{e.placedNone}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-body">
              {placedOn.map((p) => (
                <li key={p.pageId}>
                  <a className="text-accent underline underline-offset-2" href={p.href}>
                    {p.title || "…"}
                  </a>
                  {!p.published && <span className="text-muted"> ({e.draftOnly})</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        {canEdit && (
          <Card>
            <div className="flex flex-col items-start gap-3">
              <p className="text-body text-ink-2">{e.archiveText}</p>
              <Button disabled={pending} onClick={() => start(async () => void (await setStatus(archived ? "active" : "archived")))} data-form-archive>
                {archived ? e.restore : e.archive}
              </Button>
              {confirming === "delete" ? (
                <div className="flex flex-col gap-2 rounded-panel bg-danger-soft p-3" role="alertdialog" aria-label={fillWords(e.deleteTitle, { name: form.name })}>
                  {blockedBy ? (
                    <>
                      <p className="text-body text-danger-text">{e.deleteUsed}</p>
                      <ul className="list-disc pl-5 text-body">
                        {blockedBy.map((u) => (
                          <li key={u.pageId}>{u.title || "…"}</li>
                        ))}
                      </ul>
                      <Button onClick={() => (setConfirming(null), setBlockedBy(null))}>{e.cancel}</Button>
                    </>
                  ) : (
                    <>
                      <p className="text-body-strong text-danger-text">{fillWords(e.deleteTitle, { name: form.name })}</p>
                      <div className="flex gap-2">
                        <Button
                          kind="danger"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              const outcome = await remove();
                              if (outcome.ok) router.push(listHref);
                              else if ("uses" in outcome) setBlockedBy(outcome.uses);
                            })
                          }
                          data-form-delete-yes
                        >
                          {e.yesDelete}
                        </Button>
                        <Button onClick={() => setConfirming(null)}>{e.cancel}</Button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <Button kind="link" icon={<Trash2 aria-hidden className="size-4" />} onClick={() => (placedOn.length > 0 ? (setBlockedBy(placedOn), setConfirming("delete")) : setConfirming("delete"))} data-form-delete>
                  {e.delete}
                </Button>
              )}
            </div>
          </Card>
        )}
      </aside>
    </div>
    </div>
  );
}

/** One question: its kind, words, whether it must be answered, its hint and a choice's options. */
function QuestionFields({
  question: q,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  question: FormQuestion;
  first: boolean;
  last: boolean;
  onChange: (patch: Partial<FormQuestion>) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const e = useAdminText("forms").editor;
  const kinds = useAdminText("blocks").lists.formFieldKinds as Record<FormFieldKind, string>;
  const usual = useAdminText("blocks").form.labelHints as Partial<Record<FormFieldKind, string>>;
  const labelled = LABELLED_KINDS.includes(q.kind);
  const [optionsText, setOptionsText] = useState((q.options ?? []).map((o) => o.text).join("\n"));
  return (
    <div className="flex flex-col gap-3" data-question={q.id}>
      <div className="flex flex-wrap items-end gap-3">
        <label className={`${label} w-full sm:w-44`}>
          <span className={labelText}>{e.kind}</span>
          <select
            className={input}
            value={q.kind}
            onChange={(ev) => {
              const kind = ev.target.value as FormFieldKind;
              onChange({ kind, ...(kind === "select" && !q.options?.length ? { options: [plainWords("")] } : {}) });
            }}
          >
            {(Object.keys(FORM_FIELD_KINDS) as FormFieldKind[]).map((k) => (
              <option key={k} value={k}>
                {kinds[k] ?? FORM_FIELD_KINDS[k]}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} min-w-48 flex-1`}>
          <span className={labelText}>{e.question}</span>
          <input
            className={input}
            value={q.label.text}
            placeholder={labelled ? "" : (usual[q.kind] ?? "")}
            maxLength={200}
            onChange={(ev) => onChange({ label: withText(q.label, ev.target.value) })}
          />
        </label>
      </div>
      {q.kind === "select" && (
        <label className={label}>
          <span className={labelText}>{e.choices}</span>
          <textarea
            className={`${input} min-h-20`}
            value={optionsText}
            onChange={(ev) => {
              setOptionsText(ev.target.value);
              const lines = ev.target.value.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, FORM_OPTIONS_MAX);
              onChange({ options: lines.map((text, i) => ({ text, byLocale: q.options?.[i]?.text === text ? q.options[i].byLocale : {} })) });
            }}
          />
          <span className={hint}>{fillWords(e.choicesHint, { max: FORM_OPTIONS_MAX })}</span>
        </label>
      )}
      {q.kind !== "checkbox" && q.kind !== "select" && (
        <label className={label}>
          <span className={labelText}>{e.placeholder}</span>
          <input className={input} value={q.placeholder?.text ?? ""} maxLength={200} onChange={(ev) => onChange({ placeholder: ev.target.value ? withText(q.placeholder, ev.target.value) : undefined })} />
        </label>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tick label={q.kind === "checkbox" ? e.requiredTick : e.required} checked={Boolean(q.required)} onChange={(required) => onChange({ required: required || undefined })} />
        <div className="flex gap-1">
          <Button kind="icon" aria-label={e.up} disabled={first} onClick={() => onMove(-1)} icon={<ArrowUp aria-hidden className="size-4" />} />
          <Button kind="icon" aria-label={e.down} disabled={last} onClick={() => onMove(1)} icon={<ArrowDown aria-hidden className="size-4" />} />
          <Button kind="icon" aria-label={e.remove} onClick={onRemove} icon={<Trash2 aria-hidden className="size-4" />} />
        </div>
      </div>
    </div>
  );
}

function Tick({ label: text, hint: help, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex items-start gap-2 text-sm">
      <input type="checkbox" className="mt-1 size-4" checked={checked} onChange={(ev) => onChange(ev.target.checked)} />
      <span>
        <span className="text-ink">{text}</span>
        {help && <span className="block text-xs text-muted">{help}</span>}
      </span>
    </label>
  );
}

function WordsField({
  label: text,
  value,
  hint: help,
  placeholder,
  multiline = false,
  onChange,
}: {
  label: string;
  value: Words | undefined;
  hint?: string;
  placeholder?: string;
  multiline?: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <label className={label}>
      <span className={labelText}>{text}</span>
      {multiline ? (
        <textarea className={`${input} min-h-20`} value={value?.text ?? ""} placeholder={placeholder} maxLength={500} onChange={(ev) => onChange(ev.target.value)} />
      ) : (
        <input className={input} value={value?.text ?? ""} placeholder={placeholder} maxLength={100} onChange={(ev) => onChange(ev.target.value)} />
      )}
      {help && <span className={hint}>{help}</span>}
    </label>
  );
}
