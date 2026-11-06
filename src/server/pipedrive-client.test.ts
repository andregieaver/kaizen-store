import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { PipedriveError, pipedriveWhoAmI, readPipedriveAccount } = await import("./pipedrive-client");
const { planImport } = await import("@/lib/pipedrive");

/** A stand-in for Pipedrive's API: lists by path, paged two at a time, with the calls it was asked. */
function fakePipedrive(lists: Record<string, unknown[]>, o: { refuse?: boolean; limited?: number } = {}) {
  const calls: { path: string; token: string | null; query: string }[] = [];
  let limited = o.limited ?? 0;
  const pdFetch = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const token = new Headers(init?.headers).get("x-api-token");
    calls.push({ path: url.pathname, token, query: url.search });
    if (o.refuse) return new Response('{"success":false}', { status: 401 });
    if (limited > 0) {
      limited -= 1;
      return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
    }
    if (url.pathname === "/v1/users/me") return Response.json({ success: true, data: { name: "Lisa", company_name: "Human Web" } });
    const all = lists[url.pathname] ?? [];
    if (url.pathname.startsWith("/v1/")) {
      const start = Number(url.searchParams.get("start") ?? 0);
      const page = all.slice(start, start + 2);
      const more = start + 2 < all.length;
      return Response.json({ success: true, data: page, additional_data: { pagination: { more_items_in_collection: more, next_start: start + 2 } } });
    }
    const at = Number(url.searchParams.get("cursor") ?? 0);
    const page = all.slice(at, at + 2);
    return Response.json({ success: true, data: page, additional_data: { next_cursor: at + 2 < all.length ? String(at + 2) : null } });
  }) as unknown as typeof globalThis.fetch;
  return { fetch: pdFetch, calls };
}

describe("Pipedrive's API, read with a token", () => {
  it("reads a whole account page by page, the token in a header and never in the address, and plans its import", async () => {
    const pd = fakePipedrive({
      "/api/v2/organizations": [{ id: 7, name: "Kunde AS" }],
      "/api/v2/persons": [
        { id: 11, name: "Kari", emails: [{ value: "kari@kunde.no", primary: true }], org_id: 7 },
        { id: 12, name: "Ola", emails: [{ value: "ola@kunde.no", primary: true }] },
        { id: 13, name: "Per", emails: [] },
      ],
      "/api/v2/pipelines": [{ id: 1, name: "Sales" }],
      "/api/v2/stages": [{ id: 3, pipeline_id: 1, name: "Quote sent", order_nr: 3 }],
      "/api/v2/deals": [{ id: 21, title: "Totes", status: "open", pipeline_id: 1, stage_id: 3, person_id: 11, value: 100, currency: "NOK" }],
      "/api/v2/activities": [{ id: 31, type: "call", subject: "Call Kari", due_date: "2026-11-09", deal_id: 21 }],
      "/v1/notes": [{ id: 41, content: "<p>One</p>", person_id: 11 }, { id: 42, content: "<p>Two</p>", org_id: 7 }, { id: 43, content: "<p>Three</p>", deal_id: 21 }],
    });
    const account = await readPipedriveAccount("tok_secret", { fetch: pd.fetch });
    expect(account.persons.map((p) => p.id)).toEqual(["11", "12", "13"]);
    expect(account.notes.map((n) => n.text)).toEqual(["One", "Two", "Three"]);
    expect(pd.calls.every((c) => c.token === "tok_secret" && !c.query.includes("tok_secret"))).toBe(true);
    // Three persons, two a page: two pages, the second by its cursor.
    expect(pd.calls.filter((c) => c.path === "/api/v2/persons").map((c) => c.query)).toEqual(["?limit=500", "?limit=500&cursor=2"]);
    expect(planImport(account)).toMatchObject({ companies: 1, customers: 2, deals: { open: 1, won: 0, lost: 0 }, activities: 1, notes: 3, skipped: { person_no_email: 1 } });
  });

  it("waits out a rate limit, says a refused token is one, and says whose a token is", async () => {
    const sleeps: number[] = [];
    const limited = fakePipedrive({}, { limited: 2 });
    expect(await pipedriveWhoAmI("tok", { fetch: limited.fetch, sleep: async (ms) => void sleeps.push(ms) })).toEqual({ name: "Lisa", company: "Human Web" });
    expect(sleeps).toEqual([1000, 1000]);
    await expect(pipedriveWhoAmI("bad", { fetch: fakePipedrive({}, { refuse: true }).fetch })).rejects.toEqual(new PipedriveError("token_refused"));
  });

  it("stops when the time it was given has run out", async () => {
    let clock = 0;
    const pd = fakePipedrive({ "/api/v2/organizations": [{ id: 1, name: "A" }, { id: 2, name: "B" }, { id: 3, name: "C" }] });
    const slow = (async (input: URL | string, init?: RequestInit) => {
      clock += 30_000;
      return pd.fetch(input, init);
    }) as unknown as typeof globalThis.fetch;
    await expect(readPipedriveAccount("tok", { fetch: slow, now: () => clock }, 50_000)).rejects.toEqual(new PipedriveError("too_slow"));
  });
});
