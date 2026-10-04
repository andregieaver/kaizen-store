import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }));

import { RecoveryCodesView } from "./recovery-codes-view";
import { EnrolPanel, ManageTwoStep, groupedSecret } from "./two-step-panel";

/** What a person reads before any script runs: tags out of the way, entities made plain. */
const text = (element: Parameters<typeof renderToString>[0]) =>
  renderToString(element)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/ /g, " ");

const never = async () => {
  throw new Error("not called while drawing");
};

describe("setting up two-step sign-in", () => {
  const enrol = (extra: Record<string, unknown> = {}) =>
    text(createElement(EnrolPanel, { start: never as never, finish: never as never, account: "anna@example.no", madeOn: "2026-10-03", nextHref: "/admin", ...extra }));

  it("makes nothing when it opens: only a button, and what the app is", () => {
    const html = enrol();
    expect(html).toContain("Set up an authenticator app");
    expect(html).toContain("ten recovery codes");
    expect(html).not.toContain("QR code");
    expect(html).not.toContain("Turn on two-step sign-in");
  });

  it("says it is already on, with a way on, when the session has passed the second step", () => {
    const html = enrol({ alreadyOn: true });
    expect(html).toContain("Two-step sign-in is already on for your account.");
    expect(html).toContain('href="/admin"');
    expect(html).not.toContain("Set up an authenticator app");
  });

  it("says why the person is here when something requires it", () => {
    expect(enrol({ why: "Platform admins must use two-step sign-in." })).toContain("Platform admins must use two-step sign-in.");
  });

  it("types the secret in groups of four", () => {
    expect(groupedSecret("JBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP");
    expect(groupedSecret("abcd efgh")).toBe("abcd efgh");
  });
});

describe("the recovery codes, shown once", () => {
  const codes = ["K7QM2-9WXDB", "A1B2C-D3E4F"];
  const html = text(createElement(RecoveryCodesView, { codes, account: "anna@example.no", madeOn: "2026-10-03", onContinue: () => {} }));

  it("lists every code with the account and the day, and says it is the only time", () => {
    for (const code of codes) expect(html).toContain(code);
    expect(html).toContain("anna@example.no");
    expect(html).toContain("2026-10-03");
    expect(html).toContain("only time they are shown");
  });

  it("offers copy, a file and print, and holds the way on until the person says they are saved", () => {
    expect(html).toContain("Copy codes");
    expect(html).toContain("Download as a file");
    expect(html).toContain("Print");
    expect(html).toContain("I have saved these codes");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Continue<\/button>/);
  });
});

describe("two-step sign-in on Your account", () => {
  const manage = (extra: Record<string, unknown> = {}) =>
    text(
      createElement(ManageTwoStep, {
        enrolled: false,
        codesLeft: 0,
        platformAdmin: false,
        recoveryAvailable: true,
        setUpHref: "/admin/sign-in/two-step/set-up?next=/admin/account",
        account: "anna@example.no",
        madeOn: "2026-10-03",
        regenerate: never as never,
        remove: never as never,
        ...extra,
      }),
    );

  it("says it is off, and links to setting it up", () => {
    const html = manage();
    expect(html).toContain("Off.");
    expect(html).toContain("/admin/sign-in/two-step/set-up?next=/admin/account");
    expect(html).toContain("A store's owner can require it");
  });

  it("tells a platform admin it is required", () => {
    expect(manage({ platformAdmin: true })).toContain("Platform admins must use it.");
  });

  it("says it is on, how many recovery codes are left, and offers new ones and switching off", () => {
    const html = manage({ enrolled: true, codesLeft: 7 });
    expect(html).toContain("On.");
    expect(html).toContain("7 recovery codes are left.");
    expect(html).toContain("Make new recovery codes");
    expect(html).toContain("Switch off two-step sign-in");
  });

  it("says when there are none left, and in the singular for one", () => {
    expect(manage({ enrolled: true, codesLeft: 0 })).toContain("no recovery codes left");
    expect(manage({ enrolled: true, codesLeft: 1 })).toContain("1 recovery code is left.");
  });

  it("does not offer a platform admin a way to switch it off", () => {
    const html = manage({ enrolled: true, codesLeft: 3, platformAdmin: true });
    expect(html).not.toContain("Switch off two-step sign-in");
    expect(html).toContain("Platform admins cannot switch two-step sign-in off.");
  });

  it("holds new codes back where the server cannot make them", () => {
    const html = manage({ enrolled: true, codesLeft: 3, recoveryAvailable: false });
    expect(html).toContain("cannot be made on this server");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Make new recovery codes<\/button>/);
  });
});
