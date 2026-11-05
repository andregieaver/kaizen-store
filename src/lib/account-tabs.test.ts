import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountTabsView } from "@/components/account-tabs-view";
import { da } from "@/lib/messages/da";
import { en } from "@/lib/messages/en";
import { nb } from "@/lib/messages/nb";
import { sv } from "@/lib/messages/sv";

import { ACCOUNT_TABS, accountTab, accountTabHref } from "./account-tabs";

/** My account's tabs (D480): which one an address opens, where each one's link goes, and how they are drawn. */

describe("accountTab", () => {
  it("opens the tab the address names", () => {
    for (const tab of ACCOUNT_TABS) expect(accountTab(tab)).toBe(tab);
    expect(accountTab(["profile", "orders"])).toBe("profile");
  });

  it("opens the overview for anything else, the signed-out page's Create account included", () => {
    for (const value of [undefined, "", "register", "Orders", "settings ", "__proto__", "toString", []]) expect(accountTab(value)).toBe("overview");
  });
});

describe("accountTabHref", () => {
  it("leaves the overview at My account's own address and names every other tab", () => {
    expect(accountTabHref("/s/demo/no/account", "overview")).toBe("/s/demo/no/account");
    expect(accountTabHref("/s/demo/no/account", "orders")).toBe("/s/demo/no/account?tab=orders");
    expect(accountTabHref("/account", "settings")).toBe("/account?tab=settings");
  });

  it("goes round: every tab's link opens that tab", () => {
    for (const tab of ACCOUNT_TABS) {
      const query = new URL(accountTabHref("/account", tab), "https://shop.example").searchParams.get("tab") ?? undefined;
      expect(accountTab(query)).toBe(tab);
    }
  });
});

describe("the tabs' words", () => {
  it("are written by hand in every hand-written language, short enough for a phone's row of four", () => {
    for (const messages of [en, nb, sv, da]) {
      for (const tab of ACCOUNT_TABS) {
        const label = messages.account.tabs[tab];
        expect(label.trim()).not.toBe("");
        expect(label.length).toBeLessThanOrEqual(14);
      }
    }
  });
});

describe("AccountTabsView", () => {
  const tabs = ACCOUNT_TABS.map((id) => ({ id, label: en.account.tabs[id], icon: "user" as const, href: accountTabHref("/account", id) }));
  const panels = Object.fromEntries(ACCOUNT_TABS.map((id) => [id, createElement("p", null, `content of ${id}`)]));
  const draw = (active: string, live = false) => renderToString(createElement(AccountTabsView, { label: "My account", tabs, panels, active, live }));

  it("draws every tab as a link to its own address, the open one selected", () => {
    const html = draw("profile");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-label="My account"');
    for (const tab of tabs) expect(html).toContain(`href="${tab.href.replace("&", "&amp;")}"`);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/id="account-tab-profile"[^>]*aria-selected="true"/);
  });

  it("draws every tab's content, all but the open one hidden, each named by its tab", () => {
    const html = draw("settings");
    for (const id of ACCOUNT_TABS) {
      expect(html).toContain(`content of ${id}`);
      const panel = new RegExp(`<div id="account-panel-${id}" role="tabpanel" aria-labelledby="account-tab-${id}"( hidden="")?`).exec(html);
      expect(panel, id).not.toBeNull();
      expect(Boolean(panel![1]), id).toBe(id !== "settings");
    }
  });

  it("leaves every tab to the Tab key until the script runs, then only the open one", () => {
    expect(draw("overview")).not.toContain("tabindex");
    const live = draw("orders", true);
    expect(live).toMatch(/id="account-tab-orders"[^>]*tabindex="0"/);
    expect(live.match(/tabindex="-1"/g)).toHaveLength(ACCOUNT_TABS.length - 1);
  });
});
