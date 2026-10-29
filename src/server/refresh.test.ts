import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const next = vi.hoisted(() => ({ update: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ updateTag: next.update, revalidateTag: next.revalidate }));

const { refreshTag, refreshTagNow } = await import("./refresh");

describe("refreshing a tag (DATA-02)", () => {
  beforeEach(() => {
    next.update.mockReset();
    next.revalidate.mockReset();
  });

  it("updates in an action and revalidates elsewhere", () => {
    refreshTag("store:a");
    expect(next.update).toHaveBeenCalledWith("store:a");
    expect(next.revalidate).not.toHaveBeenCalled();
    next.update.mockImplementation(() => {
      throw new Error("updateTag can only be called from within a Server Action");
    });
    refreshTag("store:a");
    refreshTagNow("store:a");
    expect(next.revalidate.mock.calls).toEqual([
      ["store:a", "max"],
      ["store:a", { expire: 0 }],
    ]);
  });

  it("does nothing where no Next request runs, and throws anything else", () => {
    next.update.mockImplementation(() => {
      throw new Error("not in an action");
    });
    next.revalidate.mockImplementation(() => {
      throw new Error('Invariant: static generation store missing in revalidateTag("store:a")');
    });
    expect(() => refreshTag("store:a")).not.toThrow();
    expect(() => refreshTagNow("store:a")).not.toThrow();
    next.revalidate.mockImplementation(() => {
      throw new Error("Route /x used revalidateTag during render which is unsupported");
    });
    expect(() => refreshTag("store:a")).toThrow(/during render/);
  });
});
