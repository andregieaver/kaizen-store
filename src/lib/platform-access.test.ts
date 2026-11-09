import { describe, expect, it } from "vitest";

import { canPlatform, HOUSE_ROLE_TEMPLATE, MEMBER_ROLES, PLATFORM_ROLES, platformAreaOfPath, platformRoleOf, ROLE_WRITES } from "./platform-access";
import { ROLE_TEMPLATES } from "./permissions";

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
});
