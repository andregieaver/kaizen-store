import { describe, expect, it, vi } from "vitest";

import { alreadyThere, putStatus, putWithRetry, RETRY_WAIT_MS } from "./upload-retry";

const sent = { error: null };
const lost = { error: { message: "Failed to fetch" } };
const refused = (status: number) => ({ error: { message: "no", status } });

function tries(...outcomes: (typeof sent | typeof lost | ReturnType<typeof refused> | Error)[]) {
  const put = vi.fn(async () => {
    const next = outcomes.shift();
    if (next instanceof Error) throw next;
    return next ?? sent;
  });
  const wait = vi.fn(async () => undefined);
  return { put, wait };
}

describe("an upload straight to Storage", () => {
  it("is sent once when it arrives", async () => {
    const { put, wait } = tries(sent);
    expect(await putWithRetry(put, wait)).toEqual({ ok: true, tries: 1 });
    expect(put).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it("is sent again, after a wait, when the first try never got an answer", async () => {
    const { put, wait } = tries(lost, sent);
    expect(await putWithRetry(put, wait)).toEqual({ ok: true, tries: 2 });
    expect(wait).toHaveBeenCalledWith(RETRY_WAIT_MS);
  });

  it("is sent again when sending threw, as a browser does when it gives up on the file", async () => {
    const { put, wait } = tries(new TypeError("Failed to fetch"), sent);
    expect(await putWithRetry(put, wait)).toEqual({ ok: true, tries: 2 });
  });

  it("is sent again when Storage itself failed", async () => {
    const { put, wait } = tries(refused(503), sent);
    expect(await putWithRetry(put, wait)).toEqual({ ok: true, tries: 2 });
  });

  it("is not sent again when Storage refused it: the same file would be refused again", async () => {
    for (const status of [400, 403, 413, 415]) {
      const { put, wait } = tries(refused(status), sent);
      expect(await putWithRetry(put, wait)).toEqual({ ok: false, tries: 1, status });
      expect(put).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    }
  });

  it("counts as sent when the second try finds the file already there: only the first answer was lost", async () => {
    const { put, wait } = tries(lost, refused(409));
    expect(await putWithRetry(put, wait)).toEqual({ ok: true, tries: 2 });
    // Older Storage answers 400 and keeps 409 as its own code.
    expect(alreadyThere({ error: { status: 400, statusCode: "409", message: "The resource already exists" } })).toBe(true);
    expect(alreadyThere({ error: { status: 400, message: "mime type video/x is not supported" } })).toBe(false);
    expect(alreadyThere(sent)).toBe(false);
  });

  it("fails after two tries, saying whether Storage ever answered", async () => {
    const none = tries(lost, lost);
    expect(await putWithRetry(none.put, none.wait)).toEqual({ ok: false, tries: 2, status: null });
    const down = tries(lost, refused(500));
    expect(await putWithRetry(down.put, down.wait)).toEqual({ ok: false, tries: 2, status: 500 });
  });

  it("reads Storage's status from either place supabase-js keeps it", () => {
    expect(putStatus(sent)).toBeNull();
    expect(putStatus(lost)).toBeNull();
    expect(putStatus({ error: { status: 413 } })).toBe(413);
    expect(putStatus({ error: { statusCode: "409" } })).toBe(409);
    expect(putStatus({ error: { statusCode: "Duplicate" } })).toBeNull();
  });
});
