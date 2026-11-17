import "server-only";

import { cache } from "react";

import { setRenderCounter } from "@/db/statement-count";

/**
 * The statements one admin render sent (bloat review step 1.9): the database client adds to it (`src/db/statement-count.ts`), and the
 * admin's gate logs the two numbers when the page is sent (`admin.render`). Outside a render React's cache() gives a fresh object on each
 * call, so a job or a route handler adds to an object nobody reads: that is intended.
 */
export const renderCount = cache(() => ({ statements: 0, started: performance.now() }));

setRenderCounter(() => {
  try {
    return renderCount();
  } catch {
    return null;
  }
});

/** What the `admin.render` line carries: the two numbers and nothing else (D400). */
export function renderFields(counted: { statements: number; started: number }): { statements: number; ms: number } {
  return { statements: counted.statements, ms: Math.round(performance.now() - counted.started) };
}
