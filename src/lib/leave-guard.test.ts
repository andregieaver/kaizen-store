import { describe, expect, it } from "vitest";

import { clickLeaves, popLeaves } from "./leave-guard";

/**
 * The leave guard's decisions (code review 1.16, D787): which clicks on a link would lose an editor's unsaved changes and are asked
 * about first, and which the browser does on its own; and whether a Back or Forward left the editor's page.
 */

const HERE = "https://kaizenaflow.com/admin/demo/pages/1";
const plain = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
const link = (href: string, more: Partial<{ target: string; download: boolean; leaveAnyway: boolean }> = {}) => ({
  href,
  target: "",
  download: false,
  leaveAnyway: false,
  ...more,
});

describe("a click on a link while an editor has unsaved changes", () => {
  it("asks first when it goes to another page of the admin, by the menu, a breadcrumb or another document's address", () => {
    expect(clickLeaves(plain, link("https://kaizenaflow.com/admin/demo/orders"), HERE)).toBe("ask");
    expect(clickLeaves(plain, link("/admin/demo/pages"), HERE)).toBe("ask");
    expect(clickLeaves(plain, link("https://kaizenaflow.com/admin/demo/menus?menu=new"), "https://kaizenaflow.com/admin/demo/menus?menu=7")).toBe("ask");
    expect(clickLeaves(plain, link("https://kaizenaflow.com/admin/demo/pages/1/preview"), HERE)).toBe("ask");
    expect(clickLeaves(plain, link(HERE, { target: "_self" }), `${HERE}?part=x`)).toBe("ask");
  });

  it("lets the browser do what it does on its own: a new tab or window, a download, a modified or other button's click", () => {
    const away = link("https://kaizenaflow.com/admin/demo/orders");
    expect(clickLeaves({ ...plain, metaKey: true }, away, HERE)).toBe("pass");
    expect(clickLeaves({ ...plain, ctrlKey: true }, away, HERE)).toBe("pass");
    expect(clickLeaves({ ...plain, shiftKey: true }, away, HERE)).toBe("pass");
    expect(clickLeaves({ ...plain, altKey: true }, away, HERE)).toBe("pass");
    expect(clickLeaves({ ...plain, button: 1 }, away, HERE)).toBe("pass");
    expect(clickLeaves(plain, link(away.href, { target: "_blank" }), HERE)).toBe("pass");
    expect(clickLeaves(plain, link(away.href, { download: true }), HERE)).toBe("pass");
    expect(clickLeaves({ ...plain, defaultPrevented: true }, away, HERE)).toBe("pass");
  });

  it("leaves a part of the same page, another site and other schemes alone (another site is the browser's own question)", () => {
    expect(clickLeaves(plain, link(`${HERE}#seo`), HERE)).toBe("pass");
    expect(clickLeaves(plain, link(HERE), `${HERE}#top`)).toBe("pass");
    expect(clickLeaves(plain, link("https://example.com/help"), HERE)).toBe("pass");
    expect(clickLeaves(plain, link("mailto:hei@example.com"), HERE)).toBe("pass");
    expect(clickLeaves(plain, link("javascript:void(0)"), HERE)).toBe("pass");
    expect(clickLeaves(plain, link("http://[bad"), HERE)).toBe("pass");
  });

  it("lets a link that says it leaves without saving go without another question", () => {
    expect(clickLeaves(plain, link("/admin/demo/fields", { leaveAnyway: true }), HERE)).toBe("release");
    // Opened in a new tab, it leaves nothing.
    expect(clickLeaves({ ...plain, metaKey: true }, link("/admin/demo/fields", { leaveAnyway: true }), HERE)).toBe("pass");
  });
});

describe("the browser's Back or Forward", () => {
  it("left the editor when it shows another address, not a part of the editor's page", () => {
    expect(popLeaves("https://kaizenaflow.com/admin/demo/pages", HERE)).toBe(true);
    expect(popLeaves(`${HERE}?with=mirror`, HERE)).toBe(true);
    expect(popLeaves(`${HERE}#seo`, HERE)).toBe(false);
    expect(popLeaves(HERE, `${HERE}#seo`)).toBe(false);
  });
});
