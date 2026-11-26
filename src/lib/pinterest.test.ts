import { describe, expect, it } from "vitest";

import { grantsPins, keptBoards, parseBoards, parseTokens, pinBody, pinIdFrom, pinterestAuthorizeUrl, pinUrl, renewDue, usernameFrom } from "./pinterest";

/** Pinterest (D870 S3.4): the sign-in address, the tokens and their renewal, the boards a Pin may go to, and a Pin made from a post. */

describe("Pinterest", () => {
  it("asks for the boards, Pins and account it needs", () => {
    const url = new URL(pinterestAuthorizeUrl("1500000", "https://kaizenaflow.com/api/integrations/pinterest/callback", "state1"));
    expect(url.origin + url.pathname).toBe("https://www.pinterest.com/oauth/");
    expect(url.searchParams.get("scope")).toBe("boards:read,pins:read,pins:write,user_accounts:read");
    expect(url.searchParams.get("state")).toBe("state1");
  });

  it("reads the tokens and keeps the refresh token a renewal leaves out", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const t = parseTokens({ access_token: "pina_a", refresh_token: "pinr_a", expires_in: 2592000, refresh_token_expires_in: 31536000, scope: "boards:read,pins:write" }, now)!;
    expect(t.expiresAt.toISOString()).toBe("2030-01-31T00:00:00.000Z");
    expect(t.refreshExpiresAt.toISOString()).toBe("2031-01-01T00:00:00.000Z");
    expect(grantsPins(t.scopes)).toBe(true);
    const renewed = parseTokens({ access_token: "pina_b", expires_in: 2592000 }, now, { refresh: "pinr_a", refreshExpiresAt: t.refreshExpiresAt })!;
    expect(renewed.refresh).toBe("pinr_a");
    expect(parseTokens({ access_token: "x" }, now)).toBeNull();
    expect(renewDue(new Date("2030-01-03T00:00:00Z"), now)).toBe(true);
    expect(renewDue(new Date("2030-01-20T00:00:00Z"), now)).toBe(false);
  });

  it("offers the boards others can see, never a secret one", () => {
    const boards = parseBoards({ items: [{ id: "549755885175", name: " Kitchen  bowls ", privacy: "PUBLIC" }, { id: "549755885176", name: "Mine", privacy: "SECRET" }, { id: "x", name: "Bad" }] });
    expect(boards).toEqual([{ id: "549755885175", name: "Kitchen bowls" }]);
    expect(keptBoards(boards)).toEqual(boards);
    expect(keptBoards([{ id: "1; drop", name: "x" }])).toEqual([]);
    expect(usernameFrom({ username: "theshop" })).toBe("theshop");
  });

  it("makes a Pin with the post's title, words, price line, hashtags and link", () => {
    const body = pinBody("549755885175", { channel: "pinterest", title: "Bowls from above", caption: "Glazed in small batches.", hashtags: ["ceramics"], link: "https://shop.example/p?utm_source=pinterest", priceLine: "NOK 450" }, "https://cdn.example/pin.jpg");
    expect(body).toEqual({
      board_id: "549755885175",
      title: "Bowls from above",
      description: "Glazed in small batches.\n\nNOK 450\n\n#ceramics",
      link: "https://shop.example/p?utm_source=pinterest",
      alt_text: "Bowls from above",
      media_source: { source_type: "image_url", url: "https://cdn.example/pin.jpg" },
    });
    expect(pinIdFrom({ id: "813744226420795884" })).toBe("813744226420795884");
    expect(pinIdFrom({ id: "<x>" })).toBeNull();
    expect(pinUrl("813744226420795884")).toBe("https://www.pinterest.com/pin/813744226420795884/");
  });
});
