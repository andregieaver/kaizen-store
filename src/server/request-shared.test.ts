import { beforeEach, describe, expect, it, vi } from "vitest";

// React's cache() does nothing outside a server render, so this stands in for one render: the first call of a cached function answers every
// later call, until `render()` below starts the next render (bloat review step 0.22).
const renders = vi.hoisted(() => ({ resets: [] as (() => void)[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  cache: <T>(make: () => T) => {
    let made: T | undefined;
    let has = false;
    renders.resets.push(() => {
      has = false;
      made = undefined;
    });
    return () => (has ? (made as T) : ((has = true), (made = make())));
  },
}));
const render = () => renders.resets.forEach((reset) => reset());

vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => ({ token: "tok" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: jar.token }) }) }));
const execute = vi.hoisted(() => vi.fn());
vi.mock("@/db/client", () => ({ db: () => ({ execute }), readDb: () => ({ execute }) }));
// What getCustomer()'s module imports for its other functions is not this test's: they are not loaded here.
vi.mock("./b2b", () => ({ chooseBusinessBuyer: async () => undefined }));
vi.mock("./customer-addresses", () => ({ saveDefaultAddress: async () => undefined }));

import { getCustomer } from "./customers";
import { perRequest } from "./request-memo";

const row = { id: "c1", email: "a@example.com", name: "", phone: null, address: null, has_password: false, company_name: null, organisation_number: null, avatar_path: null };

beforeEach(() => {
  render();
  execute.mockReset();
  execute.mockResolvedValue([row]);
  jar.token = "tok";
});

describe("one render shares a shopper's facts", () => {
  it("reads the signed-in customer once for two calls, and gives both the same answer", async () => {
    const first = await getCustomer("s1");
    const second = await getCustomer("s1");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first?.id).toBe("c1");
  });

  it("reads again for a new session token: a sign-in in the same request is never answered from before it", async () => {
    await getCustomer("s1");
    jar.token = "other";
    await getCustomer("s1");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("keeps two stores apart, and starts again in the next render", async () => {
    await getCustomer("s1");
    await getCustomer("s2");
    expect(execute).toHaveBeenCalledTimes(2);
    render();
    await getCustomer("s1");
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("asks nothing without a session cookie", async () => {
    jar.token = "";
    expect(await getCustomer("s1")).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("shares a cart count and a stock read by their keys, per store and market, and not between them", async () => {
    const load = vi.fn(async () => 3);
    await perRequest("cart-count:s1:ie", load);
    await perRequest("cart-count:s1:ie", load);
    expect(load).toHaveBeenCalledTimes(1);
    await perRequest("cart-count:s1:no", load);
    await perRequest("cart-count:s2:ie", load);
    expect(load).toHaveBeenCalledTimes(3);
  });
});
