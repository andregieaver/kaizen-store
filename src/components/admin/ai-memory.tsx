"use client";

import { useState } from "react";

import { fillWords } from "@/lib/admin-fill";
import type { Memory } from "@/server/assistant-memory";

import { useAdminText } from "./admin-text";

export type AiMemoryActions = {
  update: (id: string, content: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  removeAll: () => Promise<number>;
  setLearning: (on: boolean) => Promise<void>;
};

/**
 * What the AI manager knows about the person (D103), after Kaizen Life's
 * memory page: every memory, grouped, to correct or delete, and the switch
 * that stops it learning from conversations. Memories are the person's own,
 * across their stores and the platform.
 */
export function AiMemory({ memories: initial, learning: initialLearning, actions }: { memories: Memory[]; learning: boolean; actions: AiMemoryActions }) {
  const [memories, setMemories] = useState(initial);
  const [learning, setLearning] = useState(initialLearning);
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const w = useAdminText("assistant").memory;

  async function save(memory: Memory) {
    const content = text.trim();
    if (!content) return;
    if (!(await actions.update(memory.id, content))) return setProblem(w.notChanged);
    setMemories((current) => current.map((m) => (m.id === memory.id ? { ...m, content, source: "told" } : m)));
    setEditing(null);
  }

  async function remove(memory: Memory) {
    if (!(await actions.remove(memory.id))) return;
    setMemories((current) => current.filter((m) => m.id !== memory.id));
  }

  async function removeAll() {
    if (!window.confirm(w.confirmAll)) return;
    await actions.removeAll();
    setMemories([]);
  }

  async function toggleLearning(on: boolean) {
    setLearning(on);
    await actions.setLearning(on);
  }

  const groups = (Object.keys(w.kinds) as Memory["kind"][]).map((kind) => ({ kind, items: memories.filter((m) => m.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <section aria-labelledby="memory-heading" className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="memory-heading" className="text-title text-ink">
          {w.heading}
        </h2>
        <p className="text-sm text-muted">{w.intro}</p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={learning} onChange={(event) => void toggleLearning(event.target.checked)} />
        {w.learn}
      </label>
      {problem && (
        <p role="alert" className="text-sm text-danger-text">
          {problem}
        </p>
      )}
      {memories.length === 0 ? (
        <p className="rounded-panel border border-line p-4 text-sm">{w.empty}</p>
      ) : (
        groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-2">
            <h3 className="text-body-strong text-ink">{w.kinds[group.kind]}</h3>
            <ul className="flex flex-col divide-y divide-line rounded-panel border border-line">
              {group.items.map((memory) => (
                <li key={memory.id} className="flex flex-col gap-2 p-3">
                  {editing === memory.id ? (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void save(memory);
                      }}
                    >
                      <label className="sr-only" htmlFor={`memory-${memory.id}`}>
                        {w.label}
                      </label>
                      <textarea
                        id={`memory-${memory.id}`}
                        value={text}
                        maxLength={500}
                        rows={2}
                        onChange={(event) => setText(event.target.value)}
                        className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button type="submit" className="rounded-pill bg-brand px-3 py-1.5 text-sm text-brand-ink">
                          {w.save}
                        </button>
                        <button type="button" className="rounded-pill border border-line px-3 py-1.5 text-sm" onClick={() => setEditing(null)}>
                          {w.cancel}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="text-sm">{memory.content}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                        <span>{memory.storeName ? fillWords(w.about, { store: memory.storeName }) : w.everywhere}</span>
                        <span>{w.sources[memory.source]}</span>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setEditing(memory.id);
                            setText(memory.content);
                          }}
                        >
                          {w.edit}
                        </button>
                        <button type="button" className="underline" onClick={() => void remove(memory)} aria-label={fillWords(w.forgetOne, { memory: memory.content })}>
                          {w.forget}
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {memories.length > 0 && (
        <button type="button" className="self-start text-sm text-danger-text underline" onClick={() => void removeAll()}>
          {w.forgetAll}
        </button>
      )}
    </section>
  );
}
