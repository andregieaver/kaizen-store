import { describe, expect, it } from "vitest";

import { ADMIN_LAYOUTS, ADMIN_LEVELS, ADMIN_REGIONS, adminLayout, draws, LEVEL_LAYOUTS } from "./admin-layouts";
import { ownerTabs } from "./owner-nav";
import { platformTabs } from "./platform-nav";
import { storeTabs } from "./store-nav";

/** The admin's layouts (docs/admin-style.md section 6, 7.2). */
describe("the admin's layouts", () => {
  it("have distinct ids and draw only known regions, each once, always with main", () => {
    expect(new Set(ADMIN_LAYOUTS.map((l) => l.id)).size).toBe(ADMIN_LAYOUTS.length);
    for (const layout of ADMIN_LAYOUTS) {
      for (const region of layout.regions) expect(ADMIN_REGIONS).toContain(region);
      expect(new Set(layout.regions).size).toBe(layout.regions.length);
      expect(layout.regions).toContain("main");
    }
  });

  it("give every level a registered layout, the store's the rail", () => {
    for (const level of ADMIN_LEVELS) expect(ADMIN_LAYOUTS.map((l) => l.id)).toContain(LEVEL_LAYOUTS[level]);
    expect(LEVEL_LAYOUTS.store).toBe("rail");
    expect(LEVEL_LAYOUTS.platform).toBe("rail");
    expect(LEVEL_LAYOUTS.control).toBe("rail");
    // Hosting is one page with no sections: nothing to put in a rail.
    expect(LEVEL_LAYOUTS.hosting).toBe("classic");
    expect(adminLayout("rail").id).toBe("rail");
  });

  it("never draw the sections twice: the rail or the tabs, not both", () => {
    for (const layout of ADMIN_LAYOUTS) expect(draws(layout.id, "rail") && draws(layout.id, "tabs")).toBe(false);
    expect(draws("rail", "rail")).toBe(true);
    expect(draws("classic", "tabs")).toBe(true);
  });

  it("put a store's Settings at the foot of the rail and nothing else", () => {
    const tabs = storeTabs("/admin/s", { features: ["shop"], modules: [], markets: [], localization: {} } as never);
    expect(tabs.filter((t) => t.foot).map((t) => t.label)).toEqual(["Settings"]);
  });

  it("put the platform's Settings and the owner's Account at the foot, once each", () => {
    expect(platformTabs().filter((t) => t.foot).map((t) => t.label)).toEqual(["Settings"]);
    for (const who of [{ owner: true, work: true, support: true }, { owner: false, work: false }]) {
      expect(ownerTabs(who).filter((t) => t.foot).map((t) => t.label)).toEqual(["Account"]);
    }
  });

  it("carry the counts waiting on the platform's tiles, and none when nothing waits", () => {
    const tabs = platformTabs({ requests: 2, support: 5 });
    expect(tabs.find((t) => t.label === "Requests")?.badge).toBe(2);
    expect(tabs.find((t) => t.label === "Support")?.badge).toBe(5);
    expect(platformTabs().some((t) => t.badge)).toBe(false);
  });
});
