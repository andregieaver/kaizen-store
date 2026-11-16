import { describe, expect, it } from "vitest";

import { BRAND_MARKS } from "@/components/brand-marks-data";

import { SOCIAL_NETWORKS, socialHref, textOn, type SocialNetwork } from "./social-links";

describe("social media links", () => {
  it("takes profiles' web addresses, with https added where left out", () => {
    expect(socialHref("instagram", "https://www.instagram.com/kaizen")).toBe("https://www.instagram.com/kaizen");
    expect(socialHref("facebook", "facebook.com/kaizen")).toBe("https://facebook.com/kaizen");
    expect(socialHref("x", "javascript:alert(1)")).toBeNull();
    expect(socialHref("website", "")).toBeNull();
  });

  it("takes an email address and a phone number for those", () => {
    expect(socialHref("email", "post@example.com")).toBe("mailto:post@example.com");
    expect(socialHref("email", "not an email")).toBeNull();
    expect(socialHref("phone", "+47 22 12 34 56")).toBe("tel:+4722123456");
    expect(socialHref("phone", "call us")).toBeNull();
  });

  it("puts black or white on a colour, whichever reads better", () => {
    expect(textOn("#FFFC00")).toBe("#000000");
    expect(textOn("#0866FF")).toBe("#ffffff");
  });

  it("every network has a mark", () => {
    const marks = Object.entries(BRAND_MARKS);
    expect(marks).toHaveLength(27);
    for (const [network, mark] of marks) {
      expect(mark.path.startsWith("M"), network).toBe(true);
      expect(mark.path.length, network).toBeGreaterThan(50);
      expect(mark.hex, network).toMatch(/^#[0-9A-F]{6}$/i);
    }
    const stroked = ["email", "phone", "website"];
    for (const network of Object.keys(SOCIAL_NETWORKS) as SocialNetwork[]) {
      expect(network in BRAND_MARKS || stroked.includes(network), network).toBe(true);
    }
  });
});
