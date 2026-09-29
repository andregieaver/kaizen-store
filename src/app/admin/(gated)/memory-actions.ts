"use server";

import { requireAccount } from "@/server/auth";
import { deleteAllMemories, deleteMemory, setLearning, updateMemory } from "@/server/assistant-memory";

/** The AI manager's memory (D103): each person's own, changed only by them. */

export async function updateMemoryAction(id: string, content: string): Promise<boolean> {
  const account = await requireAccount();
  return typeof content === "string" && updateMemory(account.id, String(id), { content });
}

export async function deleteMemoryAction(id: string): Promise<boolean> {
  const account = await requireAccount();
  return deleteMemory(account.id, String(id));
}

export async function deleteAllMemoriesAction(): Promise<number> {
  const account = await requireAccount();
  return deleteAllMemories(account.id);
}

export async function setLearningAction(on: boolean): Promise<void> {
  const account = await requireAccount();
  await setLearning(account.id, on === true);
}
