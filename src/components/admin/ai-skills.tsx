"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { fillWords } from "@/lib/admin-fill";
import { SKILL_STEPS_MAX, SKILL_TITLE_MAX, SKILL_WHEN_MAX, type RemoveSkill, type SaveSkill, type SkillDraft } from "@/lib/saved-skills";

import { useAdminText } from "./admin-text";
import { Button, CARD_CLASS } from "./ui";

export type SkillView = { id: string; key: string; title: string; when: string; steps: string; shared: boolean; mine: boolean; by: string | null };
export type { SaveSkill, SkillDraft } from "@/lib/saved-skills";

const field = "rounded-md border border-line bg-card px-3 py-2 text-sm";

/** One skill's form (D350): its name, when to use it and its steps, with sharing for an owner. Used by the Skills tab and *Save as skill*. */
export function SkillForm({
  start,
  save,
  canShare,
  onDone,
  onCancel,
}: {
  start: SkillDraft;
  save: SaveSkill;
  canShare: boolean;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const w = useAdminText("assistant").skills;
  const id = useId();
  const [draft, setDraft] = useState(start);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, startBusy] = useTransition();
  return (
    <form
      data-skill-form=""
      aria-busy={busy}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        setProblem(null);
        startBusy(async () => {
          const result = await save(draft);
          if (result.ok) onDone();
          else setProblem(result.problem);
        });
      }}
    >
      <label className="flex flex-col gap-1 text-sm">
        {w.title}
        <input required maxLength={SKILL_TITLE_MAX} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {w.when}
        <input maxLength={SKILL_WHEN_MAX} value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} aria-describedby={`${id}-when`} className={field} />
        <span id={`${id}-when`} className="text-caption text-muted">
          {w.whenHint}
        </span>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        {w.steps}
        <textarea
          required
          rows={6}
          maxLength={SKILL_STEPS_MAX}
          value={draft.steps}
          onChange={(e) => setDraft({ ...draft, steps: e.target.value })}
          aria-describedby={`${id}-steps`}
          className={field}
        />
        <span id={`${id}-steps`} className="text-caption text-muted">
          {w.stepsHint}
        </span>
      </label>
      {canShare && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" checked={draft.share === true} onChange={(e) => setDraft({ ...draft, share: e.target.checked })} className="mt-0.5 size-4" />
          <span>
            {w.share}
            <span className="block text-caption text-muted">{w.shareHint}</span>
          </span>
        </label>
      )}
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
      <div className="flex gap-2">
        <Button kind="main" type="submit" disabled={busy}>
          {w.save}
        </Button>
        {onCancel && (
          <Button kind="quiet" type="button" onClick={onCancel}>
            {w.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The AI manager's Skills tab (D350): the person's own skills and those shared with the store, then the built-in playbooks. */
export function AiSkills({
  skills,
  builtIn,
  canShare,
  actions,
}: {
  skills: SkillView[];
  builtIn: { id: string; title: string; when: string }[];
  canShare: boolean;
  actions: { save: SaveSkill; remove: RemoveSkill };
}) {
  const w = useAdminText("assistant").skills;
  const router = useRouter();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const done = () => {
    setEditing(null);
    router.refresh();
  };
  return (
    <div className="flex flex-col gap-6" data-ai-skills="">
      <p className="text-sm text-ink-2">{w.intro}</p>
      {editing === "new" ? (
        <div className={`${CARD_CLASS} p-4`}>
          <SkillForm start={{ title: "", when: "", steps: "" }} save={actions.save} canShare={canShare} onDone={done} onCancel={() => setEditing(null)} />
        </div>
      ) : (
        <Button kind="main" type="button" onClick={() => setEditing("new")} className="self-start">
          {w.save}
        </Button>
      )}
      {skills.length === 0 ? (
        <p className="text-sm text-muted">{w.none}</p>
      ) : (
        <ul className={`${CARD_CLASS} flex flex-col divide-y divide-line`}>
          {skills.map((skill) => (
            <li key={skill.id} className="flex flex-col gap-2 p-4" data-skill={skill.key}>
              {editing === skill.id ? (
                <SkillForm
                  start={{ id: skill.id, title: skill.title, when: skill.when, steps: skill.steps, share: skill.shared }}
                  save={actions.save}
                  canShare={canShare}
                  onDone={done}
                  onCancel={() => setEditing(null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body-strong text-ink">{skill.title}</span>
                    <span className="text-caption text-muted">
                      {skill.mine ? w.mine : fillWords(w.by, { name: skill.by ?? "" })}
                      {skill.shared ? ` · ${w.shared}` : ""}
                    </span>
                    <span className="ml-auto flex gap-2">
                      {skill.mine && (
                        <Button kind="quiet" type="button" onClick={() => setEditing(skill.id)}>
                          {w.edit}
                        </Button>
                      )}
                      {(skill.mine || canShare) && (
                        <Button
                          kind="quiet"
                          type="button"
                          onClick={async () => {
                            if (!window.confirm(w.confirmRemove)) return;
                            if (await actions.remove(skill.id)) router.refresh();
                          }}
                        >
                          {w.remove}
                        </Button>
                      )}
                    </span>
                  </div>
                  {skill.when && <p className="text-sm text-ink-2">{skill.when}</p>}
                  <ol className="list-decimal pl-5 text-sm text-ink-2">
                    {skill.steps.split("\n").map((step, index) => (
                      <li key={index}>{step}</li>
                    ))}
                  </ol>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-title text-ink">{w.builtIn}</h2>
        <p className="text-sm text-muted">{w.builtInIntro}</p>
        <ul className="flex flex-col gap-1 text-sm">
          {builtIn.map((skill) => (
            <li key={skill.id}>
              <span className="text-ink">{skill.title}</span> <span className="text-muted">· {skill.when}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
