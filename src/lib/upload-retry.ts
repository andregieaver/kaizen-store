/**
 * Sending a file straight from the browser to Storage, twice if the first try does not arrive (D536). A phone's request
 * can stop before the file's bytes leave it (the line drops, or the browser gives up on the file), and Storage never hears
 * of it; the same signed upload is still good, so it is tried once more. A refusal from Storage itself is not tried again:
 * it would only be refused again. Pure: the caller hands in how to send and how to wait.
 */

/** What supabase-js gives back for an upload: an error with Storage's status when Storage answered, without when nothing arrived. */
export type PutOutcome = { error: null | { message?: string; status?: number; statusCode?: string | number } };

/** Storage's status for a failed upload; null when the request never got an answer. */
export function putStatus(outcome: PutOutcome): number | null {
  if (!outcome.error) return null;
  const status = Number(outcome.error.status ?? outcome.error.statusCode);
  return Number.isInteger(status) && status >= 100 ? status : null;
}

/** Storage says the file is already at that path: older Storage answers 400 with its own code 409, newer ones answer 409. */
export function alreadyThere(outcome: PutOutcome): boolean {
  if (!outcome.error) return false;
  const { status, statusCode, message } = outcome.error;
  return Number(status) === 409 || Number(statusCode) === 409 || /already exists|duplicate/i.test(message ?? "");
}

export type PutResult = { ok: true; tries: number } | { ok: false; tries: number; status: number | null };

/** How long to wait before the second try. */
export const RETRY_WAIT_MS = 1500;

export async function putWithRetry(put: () => Promise<PutOutcome>, wait: (ms: number) => Promise<void>): Promise<PutResult> {
  const send = async (): Promise<PutOutcome> => {
    try {
      return await put();
    } catch (error) {
      return { error: { message: error instanceof Error ? error.message : "failed" } };
    }
  };
  const first = await send();
  if (!first.error) return { ok: true, tries: 1 };
  const refused = putStatus(first);
  // Storage answered and said no (wrong type, too large, not allowed): the same file would get the same answer.
  if (refused !== null && refused < 500) return { ok: false, tries: 1, status: refused };
  await wait(RETRY_WAIT_MS);
  const second = await send();
  if (!second.error) return { ok: true, tries: 2 };
  // The first try arrived after all and only its answer was lost: the file is there.
  if (alreadyThere(second)) return { ok: true, tries: 2 };
  return { ok: false, tries: 2, status: putStatus(second) };
}
