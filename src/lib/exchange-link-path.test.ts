import { describe, expect, it } from "vitest";

import { isChangeLinkPath, isExchangeLinkPath, isNoExtrasPath, isPayLinkPath, isPayPath } from "./pay-routes";

/** The exchange page of a return (D239 2.1): a bearer-token page with no extras, not a pay route (no card is typed there). */
describe("an exchange's page", () => {
  const TOKEN = "E".repeat(43);
  const LINKS = [`/s/demo/no/account/exchange/${TOKEN}`, `/no-en/account/exchange/${TOKEN}?x=1`, `/s/kaiza/account/exchange/${TOKEN}`, `/account/exchange/${TOKEN}`];
  const NOT_LINKS = ["/s/demo/no/account/exchange", "/s/demo/no/account/exchange/", "/s/demo/no/account/exchanges/x", "/s/demo/no/exchange/x", "/admin/demo/returns/x"];

  it.each(LINKS)("%s draws none of the layout's extras and is not a pay route", (path) => {
    expect(isExchangeLinkPath(path)).toBe(true);
    expect(isNoExtrasPath(path)).toBe(true);
    expect(isPayPath(path)).toBe(false);
    expect(isPayLinkPath(path)).toBe(false);
    expect(isChangeLinkPath(path)).toBe(false);
  });

  it.each(NOT_LINKS)("%s is not one", (path) => {
    expect(isExchangeLinkPath(path)).toBe(false);
  });
});
