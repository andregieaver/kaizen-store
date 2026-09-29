import { describe, expect, it } from "vitest";

import { consentCookieName, encodeConsent } from "./cookie-consent";
import {
  EXIT_INTENT_MIN_MS,
  NO_SCROLL,
  NO_WAY_TO_CLOSE,
  NO_WAY_TO_OPEN,
  autoAllowed,
  classProblem,
  flowRows,
  hasAutoTriggers,
  isExitIntent,
  isWorkingPath,
  keyFromHash,
  keyFromLink,
  keyProblem,
  mayRemember,
  modalDomId,
  modalHash,
  modalProblems,
  modalRows,
  modalStorageName,
  modalSummary,
  newModal,
  rememberClose,
  remembersClose,
  repeatedModalKey,
  rowModalSchema,
  shouldAutoOpen,
  slugifyKey,
  stepScrollIntent,
  triggerWords,
  uniqueKey,
  type KeyValue,
  type ModalMemory,
  type RowModal,
  type ScrollIntentState,
} from "./page-modal";

/** A storage that keeps what it is given, or refuses. */
const store = (initial: Record<string, string> = {}, refuses = false): KeyValue & { data: Map<string, string> } => {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (name) => {
      if (refuses) throw new Error("blocked");
      return data.get(name) ?? null;
    },
    setItem: (name, value) => {
      if (refuses) throw new Error("blocked");
      data.set(name, value);
    },
  };
};

const modal = (over: Partial<RowModal> = {}): RowModal => ({
  key: "promo",
  triggers: { timer: { seconds: 5 } },
  frequency: "session",
  size: "md",
  ...over,
});

describe("a modal's address", () => {
  it("is #modal-{key}, and is read back from a hash", () => {
    expect(modalDomId("promo")).toBe("modal-promo");
    expect(modalHash("summer-sale")).toBe("#modal-summer-sale");
    expect(keyFromHash("#modal-summer-sale")).toBe("summer-sale");
    for (const bad of [
      "",
      null,
      undefined,
      "#promo",
      "#modal-",
      "#modal-Promo",
      "#modal-a b",
      "#modal--x",
      `#modal-${"a".repeat(41)}`,
    ]) {
      expect(keyFromHash(bad), String(bad)).toBeNull();
    }
  });

  it("is read from a link to the page's own address too", () => {
    const here = { origin: "https://shop.example.com", pathname: "/no/tilbud", search: "?a=1" };
    expect(keyFromLink("#modal-promo", here)).toBe("promo");
    expect(keyFromLink("/no/tilbud?a=1#modal-promo", here)).toBe("promo");
    expect(keyFromLink("https://shop.example.com/no/tilbud?a=1#modal-promo", here)).toBe("promo");
    // Another page, another site or no modal in it: an ordinary link.
    expect(keyFromLink("/no/annet#modal-promo", here)).toBeNull();
    expect(keyFromLink("https://other.example.com/no/tilbud?a=1#modal-promo", here)).toBeNull();
    expect(keyFromLink("/no/tilbud?a=1", here)).toBeNull();
    expect(keyFromLink("#about", here)).toBeNull();
    expect(keyFromLink(null, here)).toBeNull();
  });

  it("is made from a name, and stays unique among the page's", () => {
    expect(slugifyKey("Summer sale!")).toBe("summer-sale");
    expect(slugifyKey("  Høstens tilbud – 20 %  ")).toBe("hostens-tilbud-20");
    expect(slugifyKey("!!!")).toBe("modal");
    expect(slugifyKey("a".repeat(60))).toHaveLength(40);
    expect(uniqueKey("promo", ["other"])).toBe("promo");
    expect(uniqueKey("promo", ["promo"])).toBe("promo-2");
    expect(uniqueKey("promo", ["promo", "promo-2"])).toBe("promo-3");
    expect(uniqueKey("a".repeat(40), ["a".repeat(40)])).toHaveLength(40);
    expect(keyProblem(uniqueKey("a".repeat(40), ["a".repeat(40)]))).toBeNull();
  });

  it("must be a slug", () => {
    expect(keyProblem("newsletter")).toBeNull();
    expect(keyProblem("summer-sale-2")).toBeNull();
    for (const bad of ["", "Promo", "a b", "-a", "a-", "a--b", "a_b", "a".repeat(41)])
      expect(keyProblem(bad), bad).not.toBeNull();
  });
});

describe("the class that opens a modal", () => {
  it("is one safe class token", () => {
    for (const ok of ["open-newsletter", "Open_1", "a", "x".repeat(40), ""]) expect(classProblem(ok), ok).toBeNull();
    for (const bad of ["1a", "-a", "a b", "a.b", ".a", "a>b", 'a"b', "a[x]", "x".repeat(41), "a,b"]) {
      expect(classProblem(bad), bad).not.toBeNull();
    }
  });
});

describe("the modal setting", () => {
  it("starts opened by a button and once per visit", () => {
    expect(newModal("promo")).toEqual({ key: "promo", triggers: { button: true }, frequency: "session", size: "md" });
    expect(modalProblems(newModal("promo"))).toEqual([]);
  });

  it("says every problem, in words", () => {
    expect(modalProblems(modal({ triggers: {} }))).toEqual([NO_WAY_TO_OPEN]);
    expect(modalProblems(modal({ triggers: { className: "a b" } }))[0]).toMatch(/one class/i);
    expect(modalProblems(modal({ frequency: "days" }))).toEqual(["Choose between 1 and 365 days."]);
    expect(modalProblems(modal({ frequency: "days", days: 0 }))).toHaveLength(1);
    expect(modalProblems(modal({ frequency: "days", days: 30 }))).toEqual([]);
    expect(modalProblems(modal({ closeButton: false, closeOnOverlay: false }))).toEqual([NO_WAY_TO_CLOSE]);
    expect(modalProblems(modal({ closeButton: false }))).toEqual([]);
    expect(modalProblems(modal({ closeOnOverlay: false }))).toEqual([]);
    expect(modalProblems(modal({ key: "Bad key" }))).toHaveLength(1);
  });

  it("is accepted or refused by the schema with the same words", () => {
    expect(rowModalSchema.safeParse(modal()).success).toBe(true);
    expect(
      rowModalSchema.safeParse(
        modal({ triggers: { button: true, className: "open-newsletter", exitIntent: true, timer: { seconds: 600 } } }),
      ).success,
    ).toBe(true);
    const refused = (value: unknown) => {
      const parsed = rowModalSchema.safeParse(value);
      return parsed.success ? null : parsed.error.issues.map((i) => i.message);
    };
    expect(refused(modal({ triggers: {} }))).toEqual([NO_WAY_TO_OPEN]);
    expect(refused(modal({ triggers: { timer: { seconds: 0 } } }))?.[0]).toMatch(/at least 1 second/);
    expect(refused(modal({ triggers: { timer: { seconds: 601 } } }))?.[0]).toMatch(/at most 600/);
    expect(refused(modal({ triggers: { timer: { seconds: 1.5 } } }))?.[0]).toMatch(/whole seconds/);
    expect(refused(modal({ triggers: { className: "a.b" } }))?.[0]).toMatch(/class name/i);
    expect(refused(modal({ frequency: "days" }))).toEqual(["Choose between 1 and 365 days."]);
    expect(refused(modal({ frequency: "days", days: 366 }))).not.toBeNull();
    expect(refused(modal({ closeButton: false, closeOnOverlay: false }))).toEqual([NO_WAY_TO_CLOSE]);
    expect(refused({ ...modal(), size: "huge" })).not.toBeNull();
    expect(refused(modal({ key: "" }))?.[0]).toMatch(/address name/);
    // An empty class name is none, and then something else must open it.
    expect(refused(modal({ triggers: { className: " " } }))).toEqual([NO_WAY_TO_OPEN]);
  });

  it("reads what a modal opens by, and says so on the row", () => {
    expect(triggerWords({ timer: { seconds: 5 }, button: true, className: "promo", exitIntent: true })).toEqual([
      "timer 5 s",
      "button",
      "class .promo",
      "exit intent",
    ]);
    expect(
      modalSummary(modal({ name: "Promo", triggers: { timer: { seconds: 5 }, button: true, exitIntent: true } })),
    ).toBe("Modal · Promo · opens by timer 5 s, button, exit intent");
    expect(modalSummary(modal({ name: "", triggers: {} }))).toBe("Modal · promo · nothing opens it yet");
  });

  it("finds the rows that are modals and the rows in the page's flow", () => {
    const rows = [{ id: "a" }, { id: "b", modal: modal() }, { id: "c", modal: modal({ key: "other" }) }];
    expect(modalRows(rows).map((r) => r.id)).toEqual(["b", "c"]);
    expect(flowRows(rows).map((r) => r.id)).toEqual(["a"]);
    expect(repeatedModalKey(rows)).toBeNull();
    expect(repeatedModalKey([...rows, { id: "d", modal: modal() }])).toBe("promo");
  });
});

describe("what opens by itself", () => {
  it("is the timer and exit intent, not a link or a class", () => {
    expect(hasAutoTriggers(modal())).toBe(true);
    expect(hasAutoTriggers(modal({ triggers: { exitIntent: true } }))).toBe(true);
    expect(hasAutoTriggers(modal({ triggers: { button: true, className: "x" } }))).toBe(false);
  });

  it("does not open on a working page, in the builder or where the page says so", () => {
    expect(autoAllowed({ pathname: "/s/shop/no/tilbud" })).toBe(true);
    expect(autoAllowed({ pathname: "/no" })).toBe(true);
    for (const path of [
      "/s/shop/no/cart",
      "/no/checkout",
      "/s/shop/no/order/123",
      "/s/shop/no/account/orders",
      "/no/wishlist",
      "/s/x/no/subscription/tok",
      "/s/x/no/deliveries",
      "/s/x/no/account/sign-in",
    ]) {
      expect(isWorkingPath(path), path).toBe(true);
      expect(autoAllowed({ pathname: path }), path).toBe(false);
    }
    expect(autoAllowed({ pathname: "/s/shop/no/tilbud", route: true })).toBe(false);
    expect(autoAllowed({ pathname: "/s/shop/no/tilbud", inAdmin: true })).toBe(false);
    // A page merely named like part of a working page's address.
    expect(isWorkingPath("/s/shop/no/carts-and-more")).toBe(false);
  });
});

describe("how often it opens by itself", () => {
  const NOW = Date.UTC(2026, 8, 29, 12);
  const memory = (session: KeyValue | null, local: KeyValue | null): ModalMemory => ({ session, local });
  const name = modalStorageName("promo");

  it("keeps its storage under one name", () => {
    expect(name).toBe("kaizen_modal_promo");
  });

  it("opens every time with `always`", () => {
    const always = modal({ frequency: "always" });
    expect(shouldAutoOpen(always, { memory: memory(store({ [name]: "1" }), store()), now: NOW })).toBe(true);
    expect(remembersClose(always)).toBe(false);
  });

  it("opens once per visit with `session`", () => {
    const session = modal();
    expect(shouldAutoOpen(session, { memory: memory(store(), store()), now: NOW })).toBe(true);
    expect(shouldAutoOpen(session, { memory: memory(store({ [name]: "1" }), store()), now: NOW })).toBe(false);
    // Closed since the page was loaded, when nothing could be kept.
    expect(shouldAutoOpen(session, { memory: memory(store(), store()), now: NOW, closed: true })).toBe(false);
  });

  it("waits its days with `days`", () => {
    const days = modal({ frequency: "days", days: 7 });
    const closedAt = (daysAgo: number) => store({ [name]: String(NOW - daysAgo * 86_400_000) });
    expect(shouldAutoOpen(days, { memory: memory(store(), store()), now: NOW })).toBe(true);
    expect(shouldAutoOpen(days, { memory: memory(store(), closedAt(3)), now: NOW })).toBe(false);
    expect(shouldAutoOpen(days, { memory: memory(store(), closedAt(7)), now: NOW })).toBe(true);
    expect(shouldAutoOpen(days, { memory: memory(store(), closedAt(30)), now: NOW })).toBe(true);
    expect(shouldAutoOpen(days, { memory: memory(store(), store({ [name]: "garbage" })), now: NOW })).toBe(true);
    expect(shouldAutoOpen(days, { memory: memory(store(), store()), now: NOW, closed: true })).toBe(false);
  });

  it("never opens by itself when nothing but a link or a class opens it", () => {
    expect(shouldAutoOpen(modal({ triggers: { button: true } }), { memory: memory(store(), store()), now: NOW })).toBe(
      false,
    );
  });

  it("works without storage, and when storage refuses", () => {
    expect(shouldAutoOpen(modal(), { memory: memory(null, null), now: NOW })).toBe(true);
    expect(shouldAutoOpen(modal(), { memory: memory(store({}, true), null), now: NOW })).toBe(true);
    expect(rememberClose(modal(), { memory: memory(null, null), now: NOW, allowed: true })).toBe(false);
    expect(rememberClose(modal(), { memory: memory(store({}, true), null), now: NOW, allowed: true })).toBe(false);
  });

  it("remembers a closing only for a visitor who allowed preferences", () => {
    const session = store();
    const local = store();
    expect(rememberClose(modal(), { memory: memory(session, local), now: NOW, allowed: false })).toBe(false);
    expect(session.data.size + local.data.size).toBe(0);
    expect(rememberClose(modal(), { memory: memory(session, local), now: NOW, allowed: true })).toBe(true);
    expect([...session.data.keys()]).toEqual([name]);
    expect(local.data.size).toBe(0);
    expect(
      rememberClose(modal({ frequency: "days", days: 3 }), { memory: memory(session, local), now: NOW, allowed: true }),
    ).toBe(true);
    expect(local.data.get(name)).toBe(String(NOW));
    // Nothing to remember for a modal shown every time or never by itself.
    expect(
      rememberClose(modal({ frequency: "always" }), { memory: memory(session, local), now: NOW + 1, allowed: true }),
    ).toBe(false);
    expect(
      rememberClose(modal({ triggers: { button: true } }), {
        memory: memory(session, local),
        now: NOW + 1,
        allowed: true,
      }),
    ).toBe(false);
  });

  it("reads the visitor's choice about preferences from the site's consent cookie", () => {
    const visitor = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
    const storeId = "8f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
    const cookie = (choices: { preferences: boolean }, id: string | null = storeId) =>
      `theme=dark; ${consentCookieName(id)}=${encodeConsent({ visitor, version: "preferences", choices: { preferences: choices.preferences, statistics: false, marketing: false } })}`;
    expect(mayRemember(cookie({ preferences: true }), storeId)).toBe(true);
    expect(mayRemember(cookie({ preferences: false }), storeId)).toBe(false);
    // Another site's choice, or none, or a damaged one, allows nothing.
    expect(mayRemember(cookie({ preferences: true }, null), storeId)).toBe(false);
    expect(mayRemember("", storeId)).toBe(false);
    expect(mayRemember(`${consentCookieName(storeId)}=damaged`, storeId)).toBe(false);
    expect(mayRemember(cookie({ preferences: true }, null), null)).toBe(true);
  });
});

describe("exit intent", () => {
  const top = { clientY: 0, relatedTarget: null };

  it("is the pointer leaving through the top of the window after a while", () => {
    expect(isExitIntent(top, EXIT_INTENT_MIN_MS)).toBe(true);
    expect(isExitIntent({ clientY: -3, relatedTarget: null }, 10_000)).toBe(true);
    // Too soon, or not through the top, or only moving to another element.
    expect(isExitIntent(top, EXIT_INTENT_MIN_MS - 1)).toBe(false);
    expect(isExitIntent({ clientY: 400, relatedTarget: null }, 10_000)).toBe(false);
    expect(isExitIntent({ clientY: 0, relatedTarget: {} }, 10_000)).toBe(false);
  });

  describe("on a touch screen: a quick scroll up after reading down the page", () => {
    /** Runs samples of [y, t] through the detector; the first sample that fires, if any. */
    const run = (samples: [number, number][], scrollable = 3000) => {
      let state: ScrollIntentState = NO_SCROLL;
      for (const [index, [y, t]] of samples.entries()) {
        const step = stepScrollIntent(state, { y, t, scrollable });
        state = step.state;
        if (step.fire) return index;
      }
      return null;
    };

    it("fires after 30% down and 200 px back up within 0.6 s", () => {
      expect(
        run([
          [0, 0],
          [500, 400],
          [1000, 800],
          [1100, 900],
          [1000, 950],
          [800, 1000],
          [700, 1050],
        ]),
      ).toBe(5);
    });

    it("does not fire before 30% of the page has been read", () => {
      expect(
        run([
          [0, 0],
          [500, 400],
          [800, 500],
          [400, 600],
        ]),
      ).toBeNull();
    });

    it("does not fire on a slow scroll up, or a small one", () => {
      expect(
        run([
          [0, 0],
          [1500, 400],
          [1400, 1500],
          [1200, 2600],
          [1000, 3700],
        ]),
      ).toBeNull();
      expect(
        run([
          [0, 0],
          [1500, 400],
          [1450, 450],
          [1400, 500],
        ]),
      ).toBeNull();
    });

    it("measures from where the scroll turned, so a second try after scrolling down again works", () => {
      expect(
        run([
          [0, 0],
          [1500, 400],
          [1450, 3000],
          [1500, 3100],
          [1350, 3200],
          [1250, 3300],
        ]),
      ).toBe(5);
    });

    it("never fires on a page too short to scroll", () => {
      expect(
        run(
          [
            [0, 0],
            [100, 100],
            [0, 200],
          ],
          0,
        ),
      ).toBeNull();
    });
  });
});
