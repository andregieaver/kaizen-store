import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { DeleteFacts } from "@/lib/privacy-delete-facts";
import { deleteLabels, stepUpLabels } from "@/lib/privacy-labels";
import { PRIVACY_LANGUAGES, shopperPrivacyText } from "@/lib/privacy-text";

import { DeletePlanView, PrivacyCard, PrivacyDoneView, PrivacyPageView } from "./privacy-account-view";
import { DeleteForm, StepUpForm, type PrivacyAction } from "./privacy-forms";

vi.mock("server-only", () => ({}));

/** The shopper's "Your data": the card, the page, the delete page and the result, in the four hand-written languages. */

const words = (markup: string) =>
  markup
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const action: PrivacyAction = async (previous) => previous;
const facts = (over: Partial<DeleteFacts> = {}): DeleteFacts => ({
  keptOrders: 2,
  keptUntil: "1 January 2033",
  subscriptions: 1,
  cards: 1,
  bonus: "€42.00",
  optOutKept: true,
  ...over,
});

describe("the Your data card in My account", () => {
  it.each(PRIVACY_LANGUAGES)("is one link to the page, in %s, and deletes nothing itself", (lang) => {
    const text = shopperPrivacyText(lang);
    const markup = renderToString(createElement(PrivacyCard, { text, storeName: "Butikken", href: "/s/demo/no/account/privacy" }));
    expect(markup).toContain('href="/s/demo/no/account/privacy"');
    expect(words(markup)).toContain(text.cardTitle);
    expect(words(markup)).toContain(text.cardIntro("Butikken"));
    expect(markup).not.toContain("<form");
  });
});

describe("the page", () => {
  const page = (over: Partial<Parameters<typeof PrivacyPageView>[0]> = {}) =>
    renderToString(
      createElement(PrivacyPageView, {
        text: shopperPrivacyText("en"),
        storeName: "Demo",
        fresh: true,
        notice: null,
        exportHref: "/s/demo/no/account/privacy/export",
        deleteHref: "/s/demo/no/account/privacy/confirm",
        accountHref: "/s/demo/no/account",
        accountLabel: "My account",
        stepUp: createElement("p", null, "STEP-UP"),
        ...over,
      }),
    );

  it("offers the download as a POST to the route and the way on to deletion when the session is fresh", () => {
    const markup = page();
    expect(markup).toMatch(/<form[^>]*method="post"[^>]*action="\/s\/demo\/no\/account\/privacy\/export"|<form[^>]*action="\/s\/demo\/no\/account\/privacy\/export"[^>]*method="post"/);
    expect(markup).toContain('href="/s/demo/no/account/privacy/confirm"');
    expect(words(markup)).toContain("Download my data");
    expect(markup).not.toContain("STEP-UP");
  });

  it("shows only the step-up, with no download and no delete, when the session is stale", () => {
    const markup = page({ fresh: false });
    expect(markup).toContain("STEP-UP");
    expect(markup).not.toContain("/export");
    expect(markup).not.toContain("/confirm");
  });

  it("announces why the shopper came back (a stale session, a file too large, a failure)", () => {
    const text = shopperPrivacyText("en");
    expect(page({ notice: "stale", fresh: false })).toContain(text.staleSession);
    expect(words(page({ notice: "too_large" }))).toContain(text.tooLarge);
    expect(words(page({ notice: "failed" }))).toContain(text.failed);
    expect(page({ notice: "stale" })).toContain('role="alert"');
  });
});

describe("the delete page", () => {
  const render = (lang: (typeof PRIVACY_LANGUAGES)[number], over: Partial<DeleteFacts> = {}) =>
    renderToString(
      createElement(DeletePlanView, {
        text: shopperPrivacyText(lang),
        storeName: "Butikken",
        facts: facts(over),
        form: createElement(DeleteForm, { labels: deleteLabels(shopperPrivacyText(lang)), erase: action, backHref: "/s/demo/no/account/privacy" }),
      }),
    );

  it.each(PRIVACY_LANGUAGES)("says what goes, what stays and until when, what else happens, and that it cannot be undone, in %s", (lang) => {
    const text = shopperPrivacyText(lang);
    const said = words(render(lang));
    expect(said).toContain(text.deleteTitle);
    expect(said).toContain(text.goesHeading);
    for (const item of text.goesItems) expect(said).toContain(item);
    expect(said).toContain(text.staysHeading);
    expect(said).toContain(text.staysOrders(2, "1 January 2033"));
    expect(said).toContain(text.staysOptOut);
    expect(said).toContain(text.subscriptionsEnd(1));
    expect(said).toContain(text.cardsRemoved(1));
    expect(said).toContain(text.bonusLost("€42.00"));
    expect(said).toContain(text.stripeNote);
    expect(said).toContain(text.irreversible);
    expect(said).toContain(text.confirmButton);
  });

  it("leaves out what does not apply: no kept orders, subscriptions, cards or credits", () => {
    const text = shopperPrivacyText("en");
    const said = words(render("en", { keptOrders: 0, keptUntil: null, subscriptions: 0, cards: 0, bonus: null, optOutKept: false }));
    expect(said).not.toContain(text.staysHeading);
    expect(said).not.toContain("subscription");
    expect(said).not.toContain("saved card");
    expect(said).not.toContain("bonus credits");
    expect(said).toContain(text.stripeNote);
    expect(said).toContain(text.confirmButton);
  });

  it("has one submit button and a way back, and falls back to English for another language", () => {
    const markup = render("en");
    expect(markup.match(/type="submit"/g)).toHaveLength(1);
    expect(markup).toContain('href="/s/demo/no/account/privacy"');
    expect(shopperPrivacyText("fi")).toBe(shopperPrivacyText("en"));
  });
});

describe("the result", () => {
  const render = (over: Partial<Parameters<typeof PrivacyDoneView>[0]> = {}) =>
    renderToString(
      createElement(PrivacyDoneView, { text: shopperPrivacyText("nb"), kept: 2, until: "1. januar 2033", emailSent: true, accountHref: "/s/demo/no/account", accountLabel: "Min konto", ...over }),
    );

  it("says what was done, what is kept until when, and where the confirmation went", () => {
    const text = shopperPrivacyText("nb");
    const said = words(render());
    expect(said).toContain(text.doneTitle);
    expect(said).toContain(text.doneText);
    expect(said).toContain(text.doneKept(2, "1. januar 2033"));
    expect(said).toContain(text.doneEmail);
  });

  it("never claims an email that was not sent", () => {
    const text = shopperPrivacyText("nb");
    const said = words(render({ emailSent: false }));
    expect(said).toContain(text.doneTextNoEmail);
    expect(said).not.toContain(text.doneText);
    expect(said).not.toContain(text.doneEmail);
  });

  it("says nothing of kept orders when none are kept", () => {
    expect(words(render({ kept: 0, until: null }))).not.toContain("regnskapsloven");
  });
});

describe("the step-up form", () => {
  const render = (hasPassword: boolean) =>
    renderToString(createElement(StepUpForm, { labels: stepUpLabels(shopperPrivacyText("en")), hasPassword, requestCode: action, confirm: action }));

  it("asks for a code to the address on file first, with a labelled field only once one was sent", () => {
    const markup = render(false);
    expect(words(markup)).toContain("Confirm it is you");
    expect(words(markup)).toContain("Send me a code");
    expect(markup).not.toContain('name="code"');
    expect(markup).not.toContain('name="password"');
  });

  it("offers the password only to accounts that have one, as a labelled password field", () => {
    const markup = render(true);
    expect(markup).toContain('name="password"');
    expect(markup).toContain('autoComplete="current-password"');
    expect(markup).toMatch(/<label[^>]*>Password<input/);
  });
});

describe("what crosses to the client components", () => {
  it("is plain words only: a function (a text with a number in it) cannot be passed from a server page", () => {
    for (const lang of PRIVACY_LANGUAGES) {
      const text = shopperPrivacyText(lang);
      for (const labels of [stepUpLabels(text), deleteLabels(text)]) {
        for (const value of Object.values(labels)) expect(typeof value).toBe("string");
      }
    }
  });
});
