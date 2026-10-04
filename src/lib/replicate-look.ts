import { NO_ANSWER, within } from "./replicate-watch";

/**
 * How the replicator uses a browser (D150): one browser for one look at a page, closed after, and a limit on how long the look may take.
 *
 * Why one browser each: on the server the browser runs as a single process, and once a page has been opened and its context closed, the
 * next page opened in that same browser may never answer (measured on kia.no: desktop 13 s, then the phone width hung for good; each in a
 * browser of its own, 7 to 12 s). A hung look held the job's lock to the end of the request, so the copy stood still for five minutes and
 * then failed.
 *
 * Why a limit: Playwright's `evaluate` has no time limit of its own, so a page whose renderer stops answering waits for ever.
 */
export const LOOK = {
  /** The original at computers' width: opening, scrolling through, photographing, reading and watching its sliders. */
  desktopMs: 100_000,
  /** The original at a phone's width, per try (it is tried twice). */
  phoneMs: 55_000,
  /** The copy, at either width. */
  copyMs: 80_000,
  /** Closing the browser: given a few seconds, never waited for beyond that. */
  closeMs: 8000,
} as const;

/** A look that did not finish in time. */
export class LookTimeout extends Error {
  constructor(public readonly ms: number) {
    super(`The page did not finish loading and being measured within ${Math.round(ms / 1000)} seconds.`);
  }
}

/**
 * Starts a browser, runs `work` with it and closes it, whatever happens. When `work` takes longer than `ms` the browser is closed under it
 * (which ends whatever it was waiting for) and a `LookTimeout` is thrown. A browser that cannot be closed in time is left to the server.
 */
export async function looking<B extends { close(): Promise<void> }, T>(launch: () => Promise<B>, ms: number, work: (browser: B) => Promise<T>): Promise<T> {
  const browser = await launch();
  try {
    const running = work(browser);
    // If the limit wins, `running` is left to end on its own once the browser is closed: its failure then is not news.
    running.catch(() => {});
    const result = await within(running, ms);
    if (result === NO_ANSWER) throw new LookTimeout(ms);
    return result;
  } finally {
    await within(browser.close().catch(() => {}), LOOK.closeMs);
  }
}

/**
 * What to tell the owner of a look that failed: our own plain sentences are kept, and the browser's raw messages
 * ("page.screenshot: Protocol error (Page.captureScreenshot) …") become one sentence of what happened.
 */
export function lookProblem(error: unknown): string {
  const text = error instanceof Error ? error.message : "";
  if (error instanceof LookTimeout) return text;
  if (/Protocol error|^(page|browser|browserContext|locator|frame)\.|Target (page|closed)|has been closed|crash|out of memory/i.test(text)) {
    return "The browser stopped while it was looking at the page (it may have run out of memory on a very long page). Try again.";
  }
  return text && text !== "Stopped." ? text : "The page could not be opened.";
}
