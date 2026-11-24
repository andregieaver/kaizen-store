import { describe, expect, it } from "vitest";

import { canPlatform, HOUSE_ROLE_TEMPLATE, isLegalReviewer, isTeamRole, mayReadLegalReviews, MEMBER_ROLES, PLATFORM_AREAS, PLATFORM_ROLES, platformAreaIn, platformAreaOfPath, platformRoleOf, ROLE_WRITES } from "./platform-access";
import { ROLE_TEMPLATES } from "./permissions";
import { PLATFORM_SECTIONS, platformItemsOf, platformNavAreas } from "./platform-nav";

describe("roles on the platform's team (D510)", () => {
  it("reads a role from an account: an owner by platform_admin, else the role kept, else none", () => {
    expect(platformRoleOf({ platformAdmin: true, platformRole: "content" })).toBe("owner");
    expect(platformRoleOf({ platformAdmin: false, platformRole: "finance" })).toBe("finance");
    expect(platformRoleOf({ platformAdmin: false, platformRole: "boss" })).toBeNull();
    expect(platformRoleOf({ platformAdmin: false })).toBeNull();
    expect(platformRoleOf(null)).toBeNull();
  });

  it("lets every role read, an owner change everything, and the others only their own area", () => {
    for (const role of PLATFORM_ROLES) for (const area of ["home", "website", "stores", "plans", "support", "settings"] as const) expect(canPlatform(role, area, "read")).toBe(true);
    expect(canPlatform(null, "home", "read")).toBe(false);
    expect(canPlatform("owner", "settings")).toBe(true);
    expect(canPlatform("content", "website")).toBe(true);
    expect(canPlatform("content", "plans")).toBe(false);
    expect(canPlatform("finance", "plans")).toBe(true);
    expect(canPlatform("finance", "website")).toBe(false);
    expect(canPlatform("support", "support")).toBe(true);
    expect(canPlatform("support", "stores")).toBe(true);
    expect(canPlatform("read_only", "website")).toBe(false);
    // Settings, the team and the AI manager are the owners' alone.
    for (const role of MEMBER_ROLES) expect(ROLE_WRITES[role]).not.toContain("settings");
  });

  it("gives each member a store role in Kaizena Flow's store that changes no more than their work", () => {
    expect(ROLE_TEMPLATES[HOUSE_ROLE_TEMPLATE.read_only].permissions.every((k) => k.endsWith(":read"))).toBe(true);
    expect(ROLE_TEMPLATES[HOUSE_ROLE_TEMPLATE.content].permissions).toContain("website:write");
    expect(ROLE_TEMPLATES[HOUSE_ROLE_TEMPLATE.support].permissions).toContain("support:write");
    expect(ROLE_TEMPLATES[HOUSE_ROLE_TEMPLATE.finance].permissions.filter((k) => k.endsWith(":write"))).toEqual(["analytics:write"]);
  });

  it("knows each platform page's area from the navigation, and leaves the rest to the owners", () => {
    expect(platformAreaOfPath("/admin/platform")).toBe("home");
    expect(platformAreaOfPath("/admin/platform/pages/new")).toBe("website");
    expect(platformAreaOfPath("/articles/123")).toBe("website");
    expect(platformAreaOfPath("/themes/demo-stores/x")).toBe("website");
    expect(platformAreaOfPath("/docs/feedback")).toBe("website");
    expect(platformAreaOfPath("/stores/acme")).toBe("stores");
    expect(platformAreaOfPath("/requests")).toBe("stores");
    expect(platformAreaOfPath("/plans/analytics/payouts/abc")).toBe("plans");
    expect(platformAreaOfPath("/discounts/1")).toBe("plans");
    expect(platformAreaOfPath("/support/stores")).toBe("support");
    expect(platformAreaOfPath("/chat")).toBe("support");
    expect(platformAreaOfPath("/team")).toBe("settings");
    expect(platformAreaOfPath("/assistant")).toBe("settings");
    expect(platformAreaOfPath("/somewhere-new")).toBe("settings");
  });

  it("reads the area a page's entry names (D851): a sidebar page given another area takes its own pages along, and nothing else", () => {
    const sections = PLATFORM_SECTIONS.map((s) => ({ ...s, groups: s.groups.map((g) => ({ ...g, items: g.items.map((i) => (i.path === "/discounts" ? { ...i, area: "website" as const } : i)) })) }));
    const areas = platformNavAreas(sections);
    expect(platformAreaIn(areas, "/discounts")).toBe("website");
    expect(platformAreaIn(areas, "/discounts/1")).toBe("website");
    expect(platformAreaIn(areas, "/referrals")).toBe("plans");
    expect(platformAreaOfPath("/discounts")).toBe("plans");
    // Every sidebar page names an area, and every section its own page's (Themes the website's, Access requests the stores').
    for (const item of sections.flatMap(platformItemsOf)) expect(PLATFORM_AREAS, item.path).toContain(item.area);
    for (const section of sections) expect(PLATFORM_AREAS, section.key).toContain(section.area);
    expect(platformAreaOfPath("/themes")).toBe("website");
    expect(platformAreaOfPath("/requests/abc")).toBe("stores");
  });
});

describe("the Legal role (D892)", () => {
  it("is on the team but never a platform role, so no platform page or action opens to it", () => {
    expect(isTeamRole("legal")).toBe(true);
    expect(PLATFORM_ROLES as readonly string[]).not.toContain("legal");
    expect(platformRoleOf({ platformAdmin: false, platformRole: "legal" })).toBeNull();
  });

  it("opens Legal reviews to lawyers and owners, never to the platform's other roles", () => {
    expect(isLegalReviewer({ platformAdmin: false, platformRole: "legal" })).toBe(true);
    expect(isLegalReviewer({ platformAdmin: true, platformRole: "legal" })).toBe(false);
    expect(mayReadLegalReviews({ platformAdmin: true })).toBe(true);
    expect(mayReadLegalReviews({ platformAdmin: false, platformRole: "legal" })).toBe(true);
    for (const role of MEMBER_ROLES) expect(mayReadLegalReviews({ platformAdmin: false, platformRole: role })).toBe(false);
    expect(mayReadLegalReviews(null)).toBe(false);
  });
});
