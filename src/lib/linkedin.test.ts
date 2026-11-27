import { describe, expect, it } from "vitest";

import { grantsPosting, linkedinAuthorizeUrl, memberFrom, organizationFrom, organizationIds, parseImageUpload, parseTokens, postBody, postUrl, postUrnFrom, renewDue } from "./linkedin";

/** LinkedIn (D870 S3.6): the sign-in with or without Pages, the tokens, the places a post may go, and a post with its picture. */

describe("LinkedIn", () => {
  it("asks for the profile's scopes, and the Pages' only where the app may", () => {
    const profile = new URL(linkedinAuthorizeUrl("77abc", "https://kaizenaflow.com/api/integrations/linkedin/callback", "s1", false));
    expect(profile.origin + profile.pathname).toBe("https://www.linkedin.com/oauth/v2/authorization");
    expect(profile.searchParams.get("scope")).toBe("openid profile w_member_social");
    expect(new URL(linkedinAuthorizeUrl("77abc", "https://x/cb", "s1", true)).searchParams.get("scope")).toBe("openid profile w_member_social r_organization_admin w_organization_social");
  });

  it("reads the 60-day token, with or without a refresh token", () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const plain = parseTokens({ access_token: "AQX", expires_in: 5184000, scope: "openid,profile,w_member_social" }, now)!;
    expect(plain.expiresAt.toISOString()).toBe("2030-03-02T00:00:00.000Z");
    expect(plain.refresh).toBeNull();
    const renewable = parseTokens({ access_token: "AQY", expires_in: 5184000, refresh_token: "AQR", refresh_token_expires_in: 31536000 }, now)!;
    expect(renewable.refreshExpiresAt?.toISOString()).toBe("2031-01-01T00:00:00.000Z");
    expect(parseTokens({ access_token: "AQZ" }, now)).toBeNull();
    expect(renewDue(new Date("2030-01-05T00:00:00Z"), now)).toBe(true);
    expect(renewDue(new Date("2030-02-01T00:00:00Z"), now)).toBe(false);
  });

  it("offers the member's profile and the Pages they administer, each only where the token may post", () => {
    expect(memberFrom({ sub: "782bbtaQ", name: "Kari  Nordmann" })).toEqual({ urn: "urn:li:person:782bbtaQ", name: "Kari Nordmann" });
    expect(memberFrom({ name: "No id" })).toBeNull();
    expect(organizationIds({ elements: [{ organization: "urn:li:organization:2414183", state: "APPROVED" }, { organization: "urn:li:organization:2414183" }, { organization: "bad" }] })).toEqual(["2414183"]);
    expect(organizationFrom("2414183", { localizedName: "Kaizena Flow" })).toEqual({ urn: "urn:li:organization:2414183", name: "Kaizena Flow" });
    expect(grantsPosting(["w_member_social"], "urn:li:person:782bbtaQ")).toBe(true);
    expect(grantsPosting(["w_member_social"], "urn:li:organization:2414183")).toBe(false);
    expect(grantsPosting(["w_organization_social"], "urn:li:organization:2414183")).toBe(true);
  });

  it("makes a public post with its picture, and reads the new post's address", () => {
    expect(parseImageUpload({ value: { uploadUrl: "https://www.linkedin.com/dms-uploads/abc", image: "urn:li:image:C4E10AQ" } })).toEqual({ uploadUrl: "https://www.linkedin.com/dms-uploads/abc", image: "urn:li:image:C4E10AQ" });
    expect(parseImageUpload({ value: { uploadUrl: "http://x", image: "urn:li:image:a" } })).toBeNull();
    const body = postBody("urn:li:organization:2414183", "Slow mornings.", "urn:li:image:C4E10AQ", "Bowls");
    expect(body).toMatchObject({ author: "urn:li:organization:2414183", commentary: "Slow mornings.", visibility: "PUBLIC", lifecycleState: "PUBLISHED", content: { media: { id: "urn:li:image:C4E10AQ", altText: "Bowls" } } });
    expect(postBody("urn:li:person:a", "x".repeat(4000), null, "").commentary).toHaveLength(3000);
    expect(postUrnFrom("urn:li:share:7300000000000000000")).toBe("urn:li:share:7300000000000000000");
    expect(postUrnFrom("<x>")).toBeNull();
    expect(postUrl("urn:li:share:7300000000000000000")).toBe("https://www.linkedin.com/feed/update/urn:li:share:7300000000000000000/");
  });
});
