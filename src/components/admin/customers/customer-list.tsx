"use client";

import { PhoneMore } from "@/components/admin/phone-more";
import { PHONE_MORE_HIDDEN } from "@/components/admin/phone-more-class";
import { X } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { ConfirmButton } from "@/components/admin/ui/confirm-button";
import { Pictures } from "@/components/admin/home/home-parts";
import { AdminLink } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";

type Plural = { one: string; many: string };

export type CustomerListItem = {
  key: string;
  email: string;
  name: string;
  avatar: ReactNode;
  city: string | null;
  subscribed: boolean;
  orders: number;
  lines: { title: string; picture: string | null }[];
  last: string;
  spent: string;
};

/** How many customers a phone shows before Show all (round 36, D724). */
const PHONE_FIRST = 20;

export type CustomerListWords = {
  label: string;
  columns: { person: string; bought: string; last: string; spent: string };
  orders: Plural;
  noOrder: string;
  subscribed: string;
  tickAll: string;
  /** Round 36 (D724): the button under a phone's first twenty. */
  showAll?: string;
  /** On a phone the tick boxes wait behind Select (round 20, D671). */
  select?: string;
  selectDone?: string;
  tickOne: string;
  ticked: Plural;
  untick: string;
  tagLabel: string;
  addTag: string;
  removeTag: string;
  /** Deleting the people ticked; absent where the viewer may not. */
  delete?: string;
  deleteQuestion?: Plural;
  morePictures: string;
};

/** On a phone, without Select, there is no tick column (round 20): the names have the room. */
const GRID_PHONE_PLAIN = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[2.25rem_minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_7rem]";
const GRID = "grid grid-cols-[2.25rem_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[2.25rem_minmax(0,2.2fr)_minmax(0,1.4fr)_minmax(0,1fr)_7rem]";

/**
 * The customers list (round 3, D603): a picture or initials, the town, what they last bought in pictures, the last order in words and what they
 * spent. Ticking people brings a bar to tag them; with nobody ticked there is nothing to read past the people.
 */
export function CustomerList({
  base,
  items,
  words,
  tagAction,
  deleteAction = null,
}: {
  base: string;
  items: CustomerListItem[];
  words: CustomerListWords;
  tagAction: ((state: FormState, form: FormData) => Promise<FormState>) | null;
  /** Deletes the people ticked (`customers:write`), after asking. */
  deleteAction?: ((state: FormState, form: FormData) => Promise<FormState>) | null;
}) {
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const plain = !selecting;
  const toggle = (key: string) =>
    setTicked((now) => {
      const next = new Set(now);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const allTicked = items.length > 0 && ticked.size === items.length;
  const chosen = items.filter((item) => ticked.has(item.key));
  // Round 36 (D724): a phone shows the first twenty, then Show all; choosing shows everyone.
  const kept = selecting || !words.showAll ? 0 : Math.max(0, items.length - PHONE_FIRST);
  return (
    <PhoneMore hidden={kept} label={fillWords(words.showAll ?? "", { n: items.length })} className="flex flex-col gap-4">
      {tagAction && words.select && (
        <button
          type="button"
          aria-pressed={selecting}
          onClick={() => {
            if (selecting) setTicked(new Set());
            setSelecting(!selecting);
          }}
          className="-mb-2 self-end text-sm font-medium text-ink underline underline-offset-2 sm:hidden"
        >
          {selecting ? words.selectDone : words.select}
        </button>
      )}
      <div className="overflow-hidden rounded-panel bg-card">
        <div aria-hidden={tagAction ? undefined : true} className={`${GRID} hidden border-b border-line px-5 py-2.5 text-caption text-muted sm:grid`}>
          {tagAction ? (
            <input
              type="checkbox"
              checked={allTicked}
              onChange={() => setTicked(allTicked ? new Set() : new Set(items.map((item) => item.key)))}
              aria-label={words.tickAll}
              className="size-4"
            />
          ) : (
            <span />
          )}
          <span>{words.columns.person}</span>
          <span>{words.columns.bought}</span>
          <span>{words.columns.last}</span>
          <span className="text-right">{words.columns.spent}</span>
        </div>
        <div role="list" aria-label={words.label}>
        {items.map((item, n) => {
          const on = ticked.has(item.key);
          const title = item.name || item.email;
          return (
            <div role="listitem" key={item.key} className={`${plain ? GRID_PHONE_PLAIN : GRID} border-b border-line px-5 py-3 last:border-b-0 ${on ? "bg-brand-soft/40" : ""} ${kept > 0 && n >= PHONE_FIRST ? PHONE_MORE_HIDDEN : ""}`}>
              {tagAction ? (
                <input type="checkbox" checked={on} onChange={() => toggle(item.key)} aria-label={fillWords(words.tickOne, { name: title })} className={`size-4 ${plain ? "max-sm:hidden" : ""}`} />
              ) : (
                <span className={plain ? "max-sm:hidden" : ""} />
              )}
              <AdminLink href={`${base}/${item.key}`} className="flex min-w-0 items-center gap-3 text-ink hover:underline">
                <span className="shrink-0 max-sm:hidden">{item.avatar}</span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="flex flex-wrap items-center gap-2 text-body">
                    <span className="truncate">{title}</span>
                    {item.subscribed && <span className="rounded-pill bg-insight-soft px-2 py-0.5 text-[12px] text-insight-text">{words.subscribed}</span>}
                  </span>
                  <span className="truncate text-caption text-muted max-sm:hidden">{[item.city, item.name ? item.email : null].filter(Boolean).join(" · ")}</span>
                  {/* Round 30 (D703): on a phone one line under the name says where, how many orders and when. */}
                  <span className="truncate text-caption text-muted sm:hidden">
                    {[item.city, item.orders > 0 ? countWords(item.orders, words.orders) : null, item.last].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </AdminLink>
              <span className="text-right text-body tabular-nums sm:hidden">{item.spent}</span>
              <div className={`${plain ? "col-start-1" : "col-start-2"} flex items-center gap-2 max-sm:hidden sm:col-start-auto`}>
                {item.lines.length > 0 && <Pictures lines={item.lines} size={36} max={3} moreWord={(n) => fillWords(words.morePictures, { n })} />}
                {item.orders > 0 && <span className="text-caption text-muted">{countWords(item.orders, words.orders)}</span>}
              </div>
              <span className={`${plain ? "col-start-2" : "col-start-3"} row-start-2 text-right text-caption text-muted max-sm:hidden sm:col-start-auto sm:row-start-auto sm:text-left sm:text-body sm:text-ink-2`}>{item.last}</span>
              <span className="hidden text-right text-body tabular-nums sm:block">{item.spent}</span>
            </div>
          );
        })}
        </div>
      </div>
      {tagAction && chosen.length > 0 && (
        <div role="region" aria-label={countWords(chosen.length, words.ticked)} className="sticky bottom-4 z-20 self-center rounded-[28px] bg-ink p-2 pl-5 text-card shadow-[var(--shadow-float)]">
          <ActionForm action={tagAction} className="flex flex-wrap items-center gap-2" successClassName="rounded-pill bg-card px-3 py-1 text-caption text-ink">
            <span className="mr-1 text-body">{countWords(chosen.length, words.ticked)}</span>
            {chosen.map((item) => (
              <input key={item.key} type="hidden" name="email" value={item.email} />
            ))}
            <label className="flex items-center gap-2">
              <span className="sr-only">{words.tagLabel}</span>
              <input name="tag" required maxLength={40} placeholder={words.tagLabel} className="h-9 w-40 rounded-pill border-0 px-3 text-body text-ink placeholder:text-muted" />
            </label>
            <SubmitButton name="mode" value="add">
              {words.addTag}
            </SubmitButton>
            <SubmitButton name="mode" value="remove" variant="secondary">
              {words.removeTag}
            </SubmitButton>
            <button type="button" onClick={() => setTicked(new Set())} aria-label={words.untick} className="flex size-9 items-center justify-center rounded-pill text-card hover:bg-card/10">
              <X aria-hidden className="size-4" />
            </button>
          </ActionForm>
          {deleteAction && words.delete && words.deleteQuestion && (
            <ActionForm
              action={deleteAction}
              className="mt-2 flex flex-wrap items-center gap-2 border-t border-card/15 pt-2"
              successClassName="rounded-pill bg-card px-3 py-1 text-caption text-ink"
            >
              {chosen.map((item) => (
                <input key={item.key} type="hidden" name="email" value={item.email} />
              ))}
              <ConfirmButton
                kind="none"
                className="min-h-9 rounded-pill px-3 text-body font-medium text-card underline underline-offset-2 hover:bg-card/10 disabled:opacity-50"
                question={countWords(chosen.length, words.deleteQuestion)}
                confirm={words.delete}
              >
                {words.delete}
              </ConfirmButton>
            </ActionForm>
          )}
        </div>
      )}
    </PhoneMore>
  );
}
