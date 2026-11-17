"use client";

import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import { FORM_TEMPLATE_CATEGORIES, TEMPLATE_SHARING, type FormTemplateCategory, type FormTemplateItem, type TemplateMeta, type TemplateSharing } from "@/lib/form-templates";

import { useAdminText } from "../admin-text";
import { Button, Card, Chip } from "../ui";

const input = "mt-1 w-full rounded-lg border border-edge bg-card px-3 py-2 text-body text-ink";
const label = "block text-sm";
const labelText = "text-ink-2";
const hint = "mt-1 block text-xs text-muted";

export type TemplateDone = { ok: true } | { ok: false; problems: string[] };

/**
 * The owner's own form templates under New form (D705 F4), one step away: who may use each (a store's owners only beyond the store) and
 * delete. On Kaizena Flow's admin: show or hide each of its templates, and delete those it saved (the starters are only hidden).
 */
export function TemplateManager({
  items,
  platform = false,
  mayShare,
  change,
  remove,
  hide,
}: {
  items: (FormTemplateItem & { hidden: boolean })[];
  platform?: boolean;
  mayShare: boolean;
  change: (id: string, meta: TemplateMeta) => Promise<TemplateDone>;
  remove: (id: string) => Promise<TemplateDone>;
  hide?: (id: string, hidden: boolean) => Promise<TemplateDone>;
}) {
  const w = useAdminText("forms");
  const t = w.templates;
  const [pending, start] = useTransition();
  const [problems, setProblems] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<string | null>(null);
  const run = (act: () => Promise<TemplateDone>) =>
    start(async () => {
      const done = await act();
      setProblems(done.ok ? [] : done.problems);
      setConfirming(null);
    });
  if (items.length === 0) return null;
  return (
    <details className="rounded-panel border border-line bg-card p-4" data-template-manager>
      <summary className="cursor-pointer text-body-strong text-ink">{platform ? t.managePlatform : t.manage}</summary>
      {platform && <p className="mt-2 text-body text-ink-2">{t.hideHint}</p>}
      {!platform && !mayShare && <p className="mt-2 text-body text-ink-2">{t.ownersOnly}</p>}
      <ul className="mt-3 flex flex-col divide-y divide-line">
        {items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center gap-3 py-3" data-template-row={item.id}>
            <span className="min-w-40 flex-1 text-body text-ink">
              {item.name}
              {item.starterKey && <span className="ml-2 text-caption text-muted">{t.starter}</span>}
              {item.hidden && <Chip>{t.hidden}</Chip>}
            </span>
            {!platform && (
              <select
                className="rounded-lg border border-edge bg-card px-2 py-1 text-body text-ink"
                aria-label={t.sharing}
                value={item.sharing}
                disabled={pending || !mayShare}
                onChange={(ev) =>
                  run(() => change(item.id, { name: item.name, description: item.description, category: item.category, sharing: ev.target.value as TemplateSharing }))
                }
                data-template-sharing
              >
                {TEMPLATE_SHARING.map((s) => (
                  <option key={s} value={s}>
                    {t.sharings[s]}
                  </option>
                ))}
              </select>
            )}
            {platform && hide && (
              <Button disabled={pending} onClick={() => run(() => hide(item.id, !item.hidden))} data-template-hide>
                {item.hidden ? t.show : t.hide}
              </Button>
            )}
            {!item.starterKey &&
              (confirming === item.id ? (
                <span className="flex flex-wrap items-center gap-2" role="alertdialog" aria-label={fillWords(t.deleteConfirm, { name: item.name })}>
                  <span className="text-body text-danger-text">{fillWords(t.deleteConfirm, { name: item.name })}</span>
                  <Button kind="danger" disabled={pending} onClick={() => run(() => remove(item.id))} data-template-delete-yes>
                    {t.delete}
                  </Button>
                  <Button onClick={() => setConfirming(null)}>{w.editor.cancel}</Button>
                </span>
              ) : (
                <Button kind="icon" aria-label={t.delete} icon={<Trash2 aria-hidden className="size-4" />} disabled={pending} onClick={() => setConfirming(item.id)} />
              ))}
          </li>
        ))}
      </ul>
      {problems.length > 0 && (
        <p role="alert" className="mt-2 text-body text-danger-text">
          {problems.join(" ")}
        </p>
      )}
    </details>
  );
}

/**
 * Save as template (D705 F4), beside a form: its questions and words become a template the owner starts new forms from, without its
 * addresses, welcome code or tags. A template already saved from this form is updated from it with one press; Kaizena Flow's admin may
 * also make a form made from a starter that starter's.
 */
export function SaveAsTemplateCard({
  formName,
  platform = false,
  mayShare,
  linked,
  starter,
  saveAs,
  update,
  adopt,
}: {
  formName: string;
  platform?: boolean;
  mayShare: boolean;
  linked: { id: string; name: string }[];
  starter: { key: string; name: string } | null;
  saveAs: (meta: TemplateMeta) => Promise<TemplateDone>;
  update: (id: string) => Promise<TemplateDone>;
  adopt?: () => Promise<TemplateDone>;
}) {
  const t = useAdminText("forms").templates;
  const [meta, setMeta] = useState<TemplateMeta>({ name: formName, description: "", category: "other", sharing: platform ? "marketplace" : "private" });
  const [pending, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const run = (act: () => Promise<TemplateDone>, success: string) =>
    start(async () => {
      const done = await act();
      setSaid(done.ok ? { ok: true, text: success } : { ok: false, text: done.problems.join(" ") });
    });
  return (
    <Card>
      <div className="flex flex-col gap-4" data-save-template>
        {linked.map((l) => (
          <div key={l.id} className="flex flex-col items-start gap-2 rounded-panel bg-sunken p-3">
            <p className="text-body text-ink">{fillWords(t.linked, { name: l.name })}</p>
            <Button disabled={pending} onClick={() => run(() => update(l.id), t.updated)} data-template-update>
              {t.update}
            </Button>
            <span className={hint}>{t.updateText}</span>
          </div>
        ))}
        {starter && adopt && (
          <div className="flex flex-col items-start gap-2 rounded-panel bg-sunken p-3">
            <p className="text-body text-ink">{fillWords(t.starterOf, { name: starter.name })}</p>
            <Button disabled={pending} onClick={() => run(adopt, t.updated)} data-template-adopt>
              {t.adopt}
            </Button>
            <span className={hint}>{t.updateText}</span>
          </div>
        )}
        <details className="group">
          <summary className="cursor-pointer text-body-strong text-ink">{t.saveTitle}</summary>
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-body text-ink-2">{t.saveText}</p>
            <label className={label}>
              <span className={labelText}>{t.name}</span>
              <input className={input} value={meta.name} maxLength={80} onChange={(ev) => setMeta({ ...meta, name: ev.target.value })} data-template-name />
            </label>
            <label className={label}>
              <span className={labelText}>{t.description}</span>
              <input className={input} value={meta.description} maxLength={200} onChange={(ev) => setMeta({ ...meta, description: ev.target.value })} />
            </label>
            <label className={label}>
              <span className={labelText}>{t.category}</span>
              <select className={input} value={meta.category} onChange={(ev) => setMeta({ ...meta, category: ev.target.value as FormTemplateCategory })}>
                {FORM_TEMPLATE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t.categories[c]}
                  </option>
                ))}
              </select>
            </label>
            {platform ? (
              <p className={hint}>{t.platformShared}</p>
            ) : (
              <label className={label}>
                <span className={labelText}>{t.sharing}</span>
                <select className={input} value={meta.sharing} disabled={!mayShare} onChange={(ev) => setMeta({ ...meta, sharing: ev.target.value as TemplateSharing })} data-template-new-sharing>
                  {TEMPLATE_SHARING.map((s) => (
                    <option key={s} value={s}>
                      {t.sharings[s]}
                    </option>
                  ))}
                </select>
                {!mayShare && <span className={hint}>{t.ownersOnly}</span>}
              </label>
            )}
            <div>
              <Button kind="main" disabled={pending || !meta.name.trim()} onClick={() => run(() => saveAs(meta), t.saved)} data-template-save>
                {t.saveButton}
              </Button>
            </div>
          </div>
        </details>
        {said && (
          <p role={said.ok ? "status" : "alert"} className={`text-body ${said.ok ? "text-positive-text" : "text-danger-text"}`}>
            {said.text}
          </p>
        )}
      </div>
    </Card>
  );
}
