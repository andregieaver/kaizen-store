import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/db/client", () => ({ db: () => ({}) }));

import { redirectsTag } from "@/lib/redirects";

import { refreshRedirects } from "./redirect-live";

describe("refreshRedirects()", () => {
  beforeEach(() => {
    cache.updateTag.mockReset();
    cache.revalidateTag.mockReset();
  });

  it("expires the lookup's tag at once in a server action", () => {
    refreshRedirects("store-1");
    expect(cache.updateTag).toHaveBeenCalledWith(redirectsTag("store-1"));
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });

  it("outside an action expires it at once too, never stale-while-revalidate (a 308 with no Location header)", () => {
    cache.updateTag.mockImplementation(() => {
      throw new Error("updateTag can only be called from within a Server Action");
    });
    refreshRedirects("store-1");
    expect(cache.revalidateTag).toHaveBeenCalledTimes(1);
    expect(cache.revalidateTag).toHaveBeenCalledWith(redirectsTag("store-1"), { expire: 0 });
  });
});
