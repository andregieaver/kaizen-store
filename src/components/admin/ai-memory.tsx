"use client";

import { useState } from "react";

import type { Memory } from "@/server/assistant-memory";

export type AiMemoryActions = {
  update: (id: string, content: string) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  removeAll: () => Promise<number>;
  setLearning: (on: boolean) => Promise<void>;
};

const KIND_WORDS: Record<Memory["kind"], string> = {
  preference: "How you like it",
  fact: "About your business",
  procedure: "Your routines",
  goal: "Your goals",
};

const SOURCE_WORDS: Record<Memory["source"], string> = {
  told: "you told it",
  learned: "learned from a conversation",
  feedback: "learned from your thumbs",
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

  async function save(memory: Memory) {
    const content = text.trim();
    if (!content) return;
    if (!(await actions.update(memory.id, content))) return setProblem("It could not be changed.");
    setMemories((current) => current.map((m) => (m.id === memory.id ? { ...m, content, source: "told" } : m)));
    setEditing(null);
  }

  async function remove(memory: Memory) {
    if (!(await actions.remove(memory.id))) return;
    setMemories((current) => current.filter((m) => m.id !== memory.id));
  }

  async function removeAll() {
    if (!window.confirm("Forget everything the AI manager knows about you?")) return;
    await actions.removeAll();
    setMemories([]);
  }

  async function toggleLearning(on: boolean) {
    setLearning(on);
    await actions.setLearning(on);
  }

  const groups = (Object.keys(KIND_WORDS) as Memory["kind"][]).map((kind) => ({ kind, items: memories.filter((m) => m.kind === kind) })).filter((g) => g.items.length > 0);

  return (
    <section aria-labelledby="memory-heading" className="flex max-w-3xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="memory-heading" className="text-lg font-semibold">
          What it knows about you
        </h2>
        <p className="text-sm text-muted">
          The AI manager keeps what you tell it to remember and learns how you work from your conversations and thumbs, so it answers the way you like. Memories are yours: only
          you and your AI manager see them. It never keeps customers&apos; details or passwords.
        </p>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" className="size-4" checked={learning} onChange={(event) => void toggleLearning(event.target.checked)} />
        Learn from my conversations
      </label>
      {problem && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      )}
      {memories.length === 0 ? (
        <p className="rounded-lg border border-border p-4 text-sm">Nothing yet. Tell it about your business, or say &ldquo;remember that …&rdquo;.</p>
      ) : (
        groups.map((group) => (
          <div key={group.kind} className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">{KIND_WORDS[group.kind]}</h3>
            <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
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
                        Memory
                      </label>
                      <textarea
                        id={`memory-${memory.id}`}
                        value={text}
                        maxLength={500}
                        rows={2}
                        onChange={(event) => setText(event.target.value)}
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                      />
                      <div className="flex gap-2">
                        <button type="submit" className="rounded-md bg-foreground px-3 py-1.5 text-sm text-background">
                          Save
                        </button>
                        <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="text-sm">{memory.content}</p>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
                        <span>{memory.storeName ? `About ${memory.storeName}` : "Everywhere"}</span>
                        <span>{SOURCE_WORDS[memory.source]}</span>
                        <button
                          type="button"
                          className="underline"
                          onClick={() => {
                            setEditing(memory.id);
                            setText(memory.content);
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="underline" onClick={() => void remove(memory)} aria-label={`Forget "${memory.content}"`}>
                          Forget
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
        <button type="button" className="self-start text-sm text-red-700 underline dark:text-red-400" onClick={() => void removeAll()}>
          Forget everything
        </button>
      )}
    </section>
  );
}
