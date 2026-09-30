import { afterEach, describe, expect, it, vi } from "vitest";

import { heldAffiliateCode, holdAffiliateCode } from "./affiliate-memory";
import { startCapture, type CaptureEnv, type CaptureOptions, type ClickLike } from "./affiliate-capture";
import { consentCookieName, CONSENT_CHANGED_EVENT, encodeConsent } from "./cookie-consent";

const STORE = "0f8fad5b-d9cb-469f-a165-70867728950e";
const consent = (marketing: boolean) =>
  `${consentCookieName(STORE)}=${encodeConsent({ visitor: "11111111-1111-4111-8111-111111111111", version: "marketing", choices: { preferences: false, statistics: false, marketing } })}`;

/** A browser in a box: the address, a cookie jar that records every write, and the listeners the capture adds. */
function browser(over: Partial<CaptureEnv> = {}) {
  const writes: string[] = [];
  const jar = { cookies: "" };
  const listeners = new Map<string, (event: never) => void>();
  const navigated: string[] = [];
  const env: CaptureEnv = {
    search: "?ref=abcdef23",
    origin: "https://shop.example",
    pathname: "/s/demo/no",
    secure: true,
    readCookies: () => jar.cookies,
    writeCookie: (cookie) => void writes.push(cookie),
    addListener: (type, listener) => {
      listeners.set(type, listener);
      return () => void listeners.delete(type);
    },
    navigate: (href) => void navigated.push(href),
    ...over,
  };
  return { env, writes, jar, listeners, navigated };
}
const options = (over: Partial<CaptureOptions> = {}): CaptureOptions => ({
  storeId: STORE,
  storeSlug: "demo",
  days: 30,
  base: "/s/demo/no",
  scope: "/s/demo",
  verify: async () => true,
  ...over,
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const click = (href: string, over: Partial<ClickLike> = {}): ClickLike & { prevented: boolean } => {
  const event = {
    defaultPrevented: false,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    anchor: { href, target: "", download: false },
    prevented: false,
    preventDefault() {
      event.prevented = true;
    },
    stopPropagation() {},
    ...over,
  };
  return event;
};

afterEach(() => holdAffiliateCode("demo", null));

describe("taking the code when a page opens", () => {
  it("holds a code from the address in memory at once, and writes no cookie without consent", async () => {
    const b = browser();
    const verify = vi.fn(async () => true);
    startCapture(b.env, options({ verify }));
    expect(heldAffiliateCode("demo")).toBe("abcdef23");
    await flush();
    expect(verify).toHaveBeenCalledExactlyOnceWith("abcdef23");
    expect(b.writes).toEqual([]);
    expect(heldAffiliateCode("demo")).toBe("abcdef23");
  });

  it("writes the store's cookie for the owner's days once marketing is allowed", async () => {
    const b = browser();
    b.jar.cookies = `a=1; ${consent(true)}`;
    startCapture(b.env, options({ days: 45 }));
    await flush();
    expect(b.writes).toEqual([`kaizen_aff_${STORE}=abcdef23; Max-Age=${45 * 86_400}; Path=/; SameSite=Lax; Secure`]);
  });

  it("writes nothing when marketing was refused, or the consent belongs to another store", async () => {
    const refused = browser();
    refused.jar.cookies = consent(false);
    startCapture(refused.env, options());
    await flush();
    expect(refused.writes).toEqual([]);
    const other = browser();
    other.jar.cookies = consent(true).replace(STORE, "1f8fad5b-d9cb-469f-a165-70867728950e");
    startCapture(other.env, options());
    await flush();
    expect(other.writes).toEqual([]);
  });

  it("writes it when the visitor allows marketing later, from what is held, and not before", async () => {
    const b = browser();
    startCapture(b.env, options({ days: 7 }));
    await flush();
    expect(b.writes).toEqual([]);
    // The visitor accepts: the consent cookie is there, and the event says so.
    b.jar.cookies = consent(true);
    b.listeners.get(CONSENT_CHANGED_EVENT)!(undefined as never);
    expect(b.writes).toEqual([`kaizen_aff_${STORE}=abcdef23; Max-Age=${7 * 86_400}; Path=/; SameSite=Lax; Secure`]);
    // Nothing held, nothing written.
    holdAffiliateCode("demo", null);
    b.listeners.get(CONSENT_CHANGED_EVENT)!(undefined as never);
    expect(b.writes).toHaveLength(1);
  });

  it("lets go of a code the server says is not one, and keeps nothing", async () => {
    const b = browser();
    b.jar.cookies = consent(true);
    startCapture(b.env, options({ verify: async () => false }));
    expect(heldAffiliateCode("demo")).toBe("abcdef23");
    await flush();
    expect(heldAffiliateCode("demo")).toBeNull();
    expect(b.writes).toEqual([]);
  });

  it("copes with the server being unreachable: the code is held, nothing is written", async () => {
    const b = browser();
    b.jar.cookies = consent(true);
    startCapture(b.env, options({ verify: async () => Promise.reject(new Error("offline")) }));
    await flush();
    expect(heldAffiliateCode("demo")).toBe("abcdef23");
    expect(b.writes).toEqual([]);
  });

  it("does nothing for an address without a code, or with one that cannot be a code, and never asks the server", async () => {
    for (const search of ["", "?a=1", "?ref=", "?ref=short", "?ref=<script>alert(1)</script>"]) {
      const b = browser({ search });
      const verify = vi.fn(async () => true);
      startCapture(b.env, options({ verify }));
      await flush();
      expect(verify, search).not.toHaveBeenCalled();
      expect(heldAffiliateCode("demo")).toBeNull();
      expect(b.writes).toEqual([]);
    }
  });

  it("never touches storage: only the cookie, through the one function it is given", async () => {
    const local = vi.fn();
    const session = vi.fn();
    vi.stubGlobal("localStorage", { setItem: local });
    vi.stubGlobal("sessionStorage", { setItem: session });
    const b = browser();
    startCapture(b.env, options());
    await flush();
    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("carrying the code through links", () => {
  it("takes a plain click out of the market's pages to the address with the code, and leaves the rest alone", async () => {
    const b = browser();
    startCapture(b.env, options());
    const onClick = b.listeners.get("click")!;
    const out = click("https://shop.example/s/demo/se");
    onClick(out as never);
    expect(out.prevented).toBe(true);
    expect(b.navigated).toEqual(["/s/demo/se?ref=abcdef23"]);
    // Within the market, to elsewhere, with a modifier, in a new tab, downloading, already carrying a code: untouched.
    for (const other of [
      click("https://shop.example/s/demo/no/cart"),
      click("https://elsewhere.example/s/demo/se"),
      click("https://shop.example/s/demo/se", { metaKey: true }),
      click("https://shop.example/s/demo/se", { button: 1 }),
      click("https://shop.example/s/demo/se", { anchor: { href: "https://shop.example/s/demo/se", target: "_blank", download: false } }),
      click("https://shop.example/s/demo/se", { anchor: { href: "https://shop.example/s/demo/se", target: "", download: true } }),
      click("https://shop.example/s/demo/se?ref=zzzzzz22"),
      click("https://shop.example/s/demo/se", { defaultPrevented: true }),
      click("https://shop.example/s/demo/se", { anchor: null }),
    ]) {
      onClick(other as never);
      expect(other.prevented).toBe(false);
    }
    expect(b.navigated).toHaveLength(1);
  });

  it("carries nothing when no code is held, and stops listening when it is torn down", () => {
    const b = browser({ search: "" });
    const stop = startCapture(b.env, options());
    const onClick = b.listeners.get("click")!;
    const out = click("https://shop.example/s/demo/se");
    onClick(out as never);
    expect(out.prevented).toBe(false);
    stop();
    expect(b.listeners.size).toBe(0);
  });

  it("carries it from the country chooser to any market of the store", () => {
    const b = browser({ pathname: "/s/demo" });
    startCapture(b.env, options({ base: null }));
    b.listeners.get("click")!(click("https://shop.example/s/demo/no") as never);
    expect(b.navigated).toEqual(["/s/demo/no?ref=abcdef23"]);
  });
});
