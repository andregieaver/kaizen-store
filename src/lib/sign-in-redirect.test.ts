import { describe, expect, it } from "vitest";

import { afterFirstStep, hasVerifiedFactor, signInFor } from "./sign-in-redirect";

const verified = { factors: [{ status: "verified" }] };

describe("where a first step of signing in ends", () => {
  it("goes straight on for a person with no factor", () => {
    expect(afterFirstStep({ factors: [] }, "/admin/kaffe/orders")).toBe("/admin/kaffe/orders");
    expect(afterFirstStep(null, null)).toBe("/admin");
    expect(afterFirstStep(undefined, undefined)).toBe("/admin");
  });

  it("goes to the second step for a person with a verified factor, keeping where they were going", () => {
    expect(afterFirstStep(verified, "/admin/kaffe/orders?show=to-send")).toBe("/admin/sign-in/two-step?next=%2Fadmin%2Fkaffe%2Forders%3Fshow%3Dto-send");
    expect(afterFirstStep(verified, null)).toBe("/admin/sign-in/two-step?next=%2Fadmin");
  });

  it("is not moved by a half-finished set-up: only a verified factor counts", () => {
    expect(hasVerifiedFactor({ factors: [{ status: "unverified" }] })).toBe(false);
    expect(hasVerifiedFactor({ factors: [{ status: "unverified" }, { status: "verified" }] })).toBe(true);
    expect(hasVerifiedFactor({ factors: null })).toBe(false);
    expect(hasVerifiedFactor({})).toBe(false);
  });

  it("never sends the person off the admin, whatever `next` says", () => {
    expect(afterFirstStep({ factors: [] }, "https://evil.example/")).toBe("/admin");
    expect(afterFirstStep({ factors: [] }, "//evil.example")).toBe("/admin");
    expect(afterFirstStep(verified, "https://evil.example/")).toBe("/admin/sign-in/two-step?next=%2Fadmin");
  });

  it("uses the caller's fallback, as a password reset link does", () => {
    expect(afterFirstStep({ factors: [] }, null, "/admin/account")).toBe("/admin/account");
    expect(afterFirstStep(verified, null, "/admin/account")).toBe("/admin/sign-in/two-step?next=%2Fadmin%2Faccount");
  });
});

describe("the sign-in page for a session that is gone", () => {
  it("keeps the admin page asked for, so the person comes back to it", () => {
    expect(signInFor("/admin/account/work/s/kaffe/invoices?show=overdue")).toBe(
      "/admin/sign-in?next=%2Fadmin%2Faccount%2Fwork%2Fs%2Fkaffe%2Finvoices%3Fshow%3Doverdue",
    );
  });
  it("carries nothing for the front page, the sign-in pages or anything outside the admin", () => {
    expect(signInFor("/admin")).toBe("/admin/sign-in");
    expect(signInFor("/admin/sign-in/two-step?next=/admin/x")).toBe("/admin/sign-in");
    expect(signInFor("https://evil.example/admin")).toBe("/admin/sign-in");
    expect(signInFor("//evil.example/admin")).toBe("/admin/sign-in");
    expect(signInFor(null)).toBe("/admin/sign-in");
  });
});
