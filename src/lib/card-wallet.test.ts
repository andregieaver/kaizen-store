import { describe, expect, it } from "vitest";

import {
  cardholdersOf,
  cardRequest,
  chargeOf,
  lastFour,
  majorAmount,
  minorAmount,
  openWalletState,
  purchaseAfter,
  purchaseInput,
  purchaseWords,
  sealWalletState,
  spentOf,
  walletAuthorizeUrl,
  walletProblem,
  walletProblemWords,
  type WalletFacts,
} from "./card-wallet";

/** The AI's card wallet (D599): the connect's state, the rules for a purchase, its card, and how its charges are read. */

const secret = Buffer.alloc(32, 3);
const ACCOUNT = "11111111-1111-4111-8111-111111111111";
const plain = (text: string) => text.replace(/ /g, " ");

describe("connecting Airwallex", () => {
  it("signs the state and refuses one altered, another server's or over", () => {
    const now = Date.UTC(2026, 10, 14, 12);
    const sealed = sealWalletState(secret, { state: "n".repeat(40), store: "shop", account: ACCOUNT }, now);
    expect(openWalletState(secret, sealed, now + 60_000)).toMatchObject({ store: "shop", account: ACCOUNT });
    expect(openWalletState(Buffer.alloc(32, 4), sealed, now)).toBeNull();
    expect(openWalletState(secret, `${sealed}x`, now)).toBeNull();
    expect(openWalletState(secret, sealed, now + 16 * 60_000)).toBeNull();
  });

  it("asks only for cards, cardholders and transactions, on the mode's own host", () => {
    const url = new URL(walletAuthorizeUrl({ mode: "sandbox", clientId: "kaizena-client", redirectUri: "https://kaizenaflow.com/api/integrations/airwallex/callback", state: "s".repeat(40) }));
    expect(url.origin + url.pathname).toBe("https://www.sandbox.airwallex.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("issuing.card:read issuing.card:write issuing.cardholder:read issuing.transaction:read");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(walletAuthorizeUrl({ mode: "live", clientId: "x".repeat(10), redirectUri: "https://k", state: "s".repeat(40) })).toMatch(/^https:\/\/www\.airwallex\.com\/oauth\/authorize\?/);
  });

  it("names cardholders by name, else email, and knows who is ready", () => {
    expect(
      cardholdersOf({
        items: [
          { cardholder_id: "ch_1", status: "READY", individual: { name: { first_name: "Kari", last_name: "Nordmann" } } },
          { cardholder_id: "ch_2", status: "PENDING", email: "ola@example.com" },
        ],
      }),
    ).toEqual([
      { id: "ch_1", name: "Kari Nordmann", active: true },
      { id: "ch_2", name: "ola@example.com", active: false },
    ]);
  });
});

describe("a purchase's rules", () => {
  const wallet: WalletFacts = { state: "on", paused: false, currency: "NOK", limitMinor: 500_000, cardholderId: "ch_1" };

  it("needs a wallet that is on, not paused, with a limit and room left", () => {
    expect(walletProblem(null, 0, 10_000)).toBe("not_connected");
    expect(walletProblem({ ...wallet, state: "choose", cardholderId: null }, 0, 10_000)).toBe("choose");
    expect(walletProblem({ ...wallet, state: "auth_failed" }, 0, 10_000)).toBe("auth_failed");
    expect(walletProblem({ ...wallet, paused: true }, 0, 10_000)).toBe("paused");
    expect(walletProblem({ ...wallet, limitMinor: null }, 0, 10_000)).toBe("no_limit");
    expect(walletProblem(wallet, 0, 50)).toBe("amount");
    expect(walletProblem(wallet, 0, null)).toBe("amount");
    expect(walletProblem(wallet, 450_000, 50_000)).toBeNull();
    expect(walletProblem(wallet, 450_001, 50_000)).toBe("over_limit");
  });

  it("says what is left of the limit in words", () => {
    expect(plain(walletProblemWords("over_limit", { currency: "NOK", limitMinor: 500_000, takenMinor: 450_000 }))).toBe(
      "That is more than is left of the AI's monthly limit: NOK 500.00 of NOK 5,000.00.",
    );
  });

  it("takes only an https page and a short reason", () => {
    expect(purchaseInput.safeParse({ what: "Stock photos", merchant: "Pics", amount: "249", url: "http://pics.example" }).success).toBe(false);
    expect(purchaseInput.parse({ what: "Stock photos", merchant: "Pics", amount: "249" })).toEqual({ what: "Stock photos", merchant: "Pics", amount: "249", why: "" });
  });

  it("words the approval from its figures", () => {
    expect(plain(purchaseWords({ what: "Stock photos", merchant: "Pics AS", amountMinor: 24_950, currency: "NOK", url: "https://pics.example/pack" }, "Kari Nordmann"))).toBe(
      "Make a single-use card for \"Stock photos\" from Pics AS, up to NOK 249.50, open for 48 hours, in Kari Nordmann's Airwallex app. The merchant's page: https://pics.example/pack. The card works once, then closes.",
    );
  });
});

describe("the card a purchase asks for", () => {
  it("is virtual, single-use, at most the amount in the wallet's currency, for two days, and named for the purchase", () => {
    const body = cardRequest({ id: "p-1", what: "Stock photos, ten pictures for the autumn page", amountMinor: 24_950, currency: "NOK" }, { cardholderId: "ch_1" }, "Kari Nordmann", new Date("2026-11-14T10:00:00Z"));
    expect(body).toMatchObject({
      request_id: "p-1",
      form_factor: "VIRTUAL",
      is_personalized: true,
      cardholder_id: "ch_1",
      program: { purpose: "COMMERCIAL" },
      authorization_controls: {
        allowed_transaction_count: "SINGLE",
        transaction_limits: { currency: "NOK", limits: [{ amount: 249.5, interval: "PER_TRANSACTION" }, { amount: 249.5, interval: "ALL_TIME" }] },
        active_from: "2026-11-14T10:00:00.000Z",
        active_to: "2026-11-16T10:00:00.000Z",
      },
      auto_close_date: "2026-11-17",
      metadata: { kaizena_purchase: "p-1" },
    });
    expect(String(body.nick_name)).toHaveLength(40);
  });

  it("converts amounts exactly both ways", () => {
    expect(majorAmount(100, "EUR")).toBe(1);
    expect(majorAmount(1_999, "SEK")).toBe(19.99);
    expect(minorAmount(19.99, "SEK")).toBe(1_999);
    expect(minorAmount(-5, "NOK")).toBe(500);
    expect(minorAmount(undefined, "NOK")).toBeNull();
    expect(lastFour("************4111")).toBe("4111");
    expect(lastFour(undefined)).toBeNull();
  });
});

describe("its charges", () => {
  const tx = (over: Record<string, unknown>) =>
    ({ transaction_id: "t1", card_id: "c1", transaction_type: "AUTHORIZATION", status: "APPROVED", billing_amount: 249.5, billing_currency: "NOK", transaction_date: "2026-11-14T11:00:00Z", merchant: { name: "PICS AS", category_code: "5815" }, ...over }) as Parameters<typeof chargeOf>[0];

  it("reads a transaction in the card's currency, and leaves out one in another", () => {
    expect(chargeOf(tx({}), "NOK")).toEqual({ ref: "t1", kind: "authorization", status: "APPROVED", amountMinor: 24_950, currency: "NOK", merchantName: "PICS AS", merchantCategory: "5815", at: new Date("2026-11-14T11:00:00Z") });
    expect(chargeOf(tx({ billing_currency: "EUR" }), "NOK")).toBeNull();
    expect(chargeOf(tx({ transaction_type: "SOMETHING" }), "NOK")?.kind).toBe("other");
  });

  it("counts clearings less refunds once cleared, else authorisations less reversals, and nothing declined", () => {
    const c = (kind: "authorization" | "clearing" | "reversal" | "refund", amountMinor: number, status = "APPROVED") => ({ kind, amountMinor, status });
    expect(spentOf([c("authorization", 24_950)])).toBe(24_950);
    expect(spentOf([c("authorization", 24_950), c("clearing", 24_000)])).toBe(24_000);
    expect(spentOf([c("authorization", 24_950), c("clearing", 24_000), c("refund", 4_000)])).toBe(20_000);
    expect(spentOf([c("authorization", 24_950), c("reversal", 24_950)])).toBe(0);
    expect(spentOf([c("authorization", 24_950, "FAILED")])).toBe(0);
  });

  it("is charged once authorised, done and closed once cleared, closed unused when its time is over", () => {
    const open = { status: "card_ready", activeTo: new Date("2026-11-16T10:00:00Z") };
    const before = new Date("2026-11-15T10:00:00Z");
    const after = new Date("2026-11-17T10:00:00Z");
    expect(purchaseAfter(open, [], before)).toEqual({ status: "card_ready", spentMinor: 0, close: false });
    expect(purchaseAfter(open, [{ kind: "authorization", status: "APPROVED", amountMinor: 24_950 }], before)).toEqual({ status: "spent", spentMinor: 24_950, close: false });
    expect(purchaseAfter(open, [{ kind: "clearing", status: "APPROVED", amountMinor: 24_950 }], before)).toEqual({ status: "closed", spentMinor: 24_950, close: true });
    expect(purchaseAfter(open, [], after)).toEqual({ status: "closed", spentMinor: 0, close: true });
    expect(purchaseAfter(open, [{ kind: "authorization", status: "DECLINED", amountMinor: 24_950 }], after)).toEqual({ status: "closed", spentMinor: 0, close: true });
  });
});
