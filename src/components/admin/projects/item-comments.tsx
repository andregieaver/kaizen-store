"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/admin/ui/button";
import { ConfirmButton } from "@/components/admin/ui/confirm-button";
import { TextArea } from "@/components/admin/ui/field";
import { adminDate } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { ProjectsMessages } from "@/lib/admin-messages/projects.en";

import type { useAct } from "./use-act";

export type EditorComment = { id: string; body: string; writtenBy: string | null; author: string | null; createdAt: string; editedAt: string | null };

/**
 * A task's comments (D903 P4.4, Life's activity thread): the team's thread under the task, oldest first, each with who wrote it and when;
 * the writer changes or deletes their own. Words are shown as text, never as markup.
 */
export function ItemComments({
  itemId,
  comments,
  me,
  canChange,
  timeZone,
  lang,
  words,
  delete: deleteWord,
  save,
  cancel,
  run,
  pending,
}: {
  itemId: string;
  comments: EditorComment[];
  me: string;
  canChange: boolean;
  timeZone: string;
  lang: AdminLang;
  words: ProjectsMessages["item"];
  delete: string;
  save: string;
  cancel: string;
  run: ReturnType<typeof useAct>["run"];
  pending: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  return (
    <section aria-labelledby={`comments-${itemId}`} className="flex flex-col gap-2">
      <h3 id={`comments-${itemId}`} className="text-body-strong text-ink">
        {words.comments}
      </h3>
      {comments.length > 0 && (
        <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
          {comments.map((c) => {
            const who = c.author ?? words.someone;
            const mine = canChange && c.writtenBy === me;
            return (
              <li key={c.id} className="flex flex-col gap-1 px-3 py-2">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm text-muted">
                    {fillWords(words.commentBy, { name: who, date: adminDate(timeZone, c.createdAt, "dayTime", lang) })}
                    {c.editedAt && ` · ${words.commentEdited}`}
                  </span>
                  {mine && editing?.id !== c.id && (
                    <span className="flex shrink-0 items-center gap-1">
                      <Button kind="icon" size="dense" aria-label={fillWords(words.commentEdit, { name: who })} onClick={() => setEditing({ id: c.id, body: c.body })}>
                        <Pencil />
                      </Button>
                      <ConfirmButton
                        kind="icon"
                        size="dense"
                        aria-label={words.commentDelete}
                        question={words.commentDeleteConfirm}
                        confirm={deleteWord}
                        action={() => run({ op: "comment.delete", id: c.id })}
                        icon={<Trash2 />}
                      />
                    </span>
                  )}
                </span>
                {editing?.id === c.id ? (
                  <form
                    className="flex flex-col gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (editing.body.trim()) run({ op: "comment.edit", id: c.id, body: editing.body }, (answer) => answer.ok && setEditing(null));
                    }}
                  >
                    <TextArea aria-label={fillWords(words.commentEdit, { name: who })} value={editing.body} onChange={(e) => setEditing({ id: c.id, body: e.target.value })} rows={3} maxLength={4000} full />
                    <span className="flex flex-wrap justify-end gap-2">
                      <Button kind="quiet" size="dense" onClick={() => setEditing(null)}>
                        {cancel}
                      </Button>
                      <Button type="submit" size="dense" disabled={pending || !editing.body.trim()}>
                        {save}
                      </Button>
                    </span>
                  </form>
                ) : (
                  <p className="whitespace-pre-wrap break-words text-body text-ink">{c.body}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canChange && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (draft.trim()) run({ op: "comment.add", itemId, body: draft }, (answer) => answer.ok && setDraft(""));
          }}
        >
          <TextArea aria-label={words.commentLabel} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4000} full />
          <Button type="submit" size="dense" className="self-end" disabled={pending || !draft.trim()}>
            {words.commentAdd}
          </Button>
        </form>
      )}
    </section>
  );
}
