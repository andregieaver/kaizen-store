import { describe, expect, it, vi } from "vitest";

import { LOOK, LookTimeout, looking, lookProblem } from "./replicate-look";

const browserOf = (close: () => Promise<void> = async () => {}) => {
  const browser = { close: vi.fn(close) };
  return { browser, launch: vi.fn(async () => browser) };
};

describe("one browser for one look", () => {
  it("gives the work its own browser and closes it afterwards", async () => {
    const { browser, launch } = browserOf();
    await expect(looking(launch, 1000, async (b) => (b === browser ? "seen" : "other"))).resolves.toBe("seen");
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("opens a new browser for every look, so a second page never meets the first one's leftovers (the kia.no hang)", async () => {
    const browsers: { close: () => Promise<void> }[] = [];
    const launch = async () => {
      const b = { close: vi.fn(async () => {}) };
      browsers.push(b);
      return b;
    };
    await looking(launch, 1000, async () => "desktop");
    await looking(launch, 1000, async () => "phone");
    expect(browsers).toHaveLength(2);
    expect(browsers[0]).not.toBe(browsers[1]);
    for (const b of browsers) expect(b.close).toHaveBeenCalledTimes(1);
  });

  it("closes the browser when the work fails, and passes the failure on", async () => {
    const { browser, launch } = browserOf();
    await expect(looking(launch, 1000, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("gives up on work that never answers, closing the browser under it", async () => {
    const { browser, launch } = browserOf();
    const started = Date.now();
    await expect(looking(launch, 40, () => new Promise<never>(() => {}))).rejects.toBeInstanceOf(LookTimeout);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it("is not stopped by work that fails after it was given up on", async () => {
    const { launch } = browserOf();
    let fail: (e: Error) => void = () => {};
    const late = new Promise<never>((_, reject) => (fail = reject));
    await expect(looking(launch, 20, () => late)).rejects.toBeInstanceOf(LookTimeout);
    fail(new Error("closed under it"));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it("does not wait for a browser that will not close", async () => {
    vi.useFakeTimers();
    try {
      const { launch } = browserOf(() => new Promise<void>(() => {}));
      const done = looking(launch, 1000, async () => "seen");
      await vi.advanceTimersByTimeAsync(LOOK.closeMs + 10);
      await expect(done).resolves.toBe("seen");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not leave a browser behind when it cannot be started", async () => {
    await expect(looking(async () => Promise.reject(new Error("no browser")), 1000, async () => "x")).rejects.toThrow("no browser");
  });

  it("keeps the whole open inside one request: a computers' look, two tries at a phone's, then the rest", () => {
    expect(LOOK.desktopMs + 2 * LOOK.phoneMs).toBeLessThanOrEqual(220_000);
  });
});

describe("what the owner is told", () => {
  it("replaces the browser's raw message with one sentence", () => {
    const raw = "page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot Call log: - taking page screenshot - disabled all CSS animations - waiting for fonts to load... - fonts loaded";
    const said = lookProblem(new Error(raw));
    expect(said).not.toMatch(/Protocol error|Call log|page\.screenshot/);
    expect(said).toMatch(/browser stopped/i);
  });

  it("keeps our own sentences and says how long a look was allowed to take", () => {
    expect(lookProblem(new Error("The page took too long to load."))).toBe("The page took too long to load.");
    expect(lookProblem(new Error("That address is on a private network."))).toBe("That address is on a private network.");
    expect(lookProblem(new LookTimeout(100_000))).toMatch(/100 seconds/);
  });

  it("never says nothing", () => {
    expect(lookProblem(undefined)).toBe("The page could not be opened.");
    expect(lookProblem(new Error(""))).toBe("The page could not be opened.");
  });
});
