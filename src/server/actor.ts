import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Who is acting (D309, `docs/ai-autopilot.md` 7.6): a person, the AI manager in their name, or the autopilot. `audit()` reads it, so
 * every audit entry says who made the change without any tool or saver taking a new argument: the AI manager runs its tools inside
 * `actingAs("ai_manager", …)` and the loop inside `actingAs("autopilot", …)`; anything else is a person.
 */

export const ACTORS = ["person", "ai_manager", "autopilot"] as const;
export type Actor = (typeof ACTORS)[number];

const store = new AsyncLocalStorage<Actor>();

export function actingAs<T>(actor: Actor, run: () => Promise<T>): Promise<T> {
  return store.run(actor, run);
}

export const currentActor = (): Actor => store.getStore() ?? "person";
