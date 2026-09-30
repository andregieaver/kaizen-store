import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { CompanyFields } from "./company-fields";

const groups = [{ id: "g1", name: "Trade", percent: 10, active: true }];
const lookup = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
const search = vi.fn(async () => ({ ok: false as const, reason: "unavailable" as const }));
const render = (props: Record<string, unknown> = {}) =>
  renderToString(createElement(CompanyFields, { groups, ...props }));

describe("the company form", () => {
  it("offers the company register lookup when it is given the store's actions", () => {
    const html = render({ lookup, search });
    expect(html).toContain("Fill in from the company register");
    expect(html).toContain('placeholder="923 609 016 or a company name"');
    expect(html).toContain(">Look up<");
  });

  it("is the same form without the lookup when it gets none", () => {
    const html = render();
    expect(html).not.toContain("Fill in from the company register");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="organisationNumber"');
  });

  it("keeps the name and number of a company being changed, editable", () => {
    const html = render({
      lookup,
      search,
      values: {
        name: "Kaffehuset AS",
        organisationNumber: "914360692",
        tierId: null,
        employeeSharePercent: 100,
        maxMembers: 25,
        active: true,
      },
    });
    expect(html).toMatch(/<input[^>]*name="name"[^>]*value="Kaffehuset AS"/);
    expect(html).toMatch(/<input[^>]*name="organisationNumber"[^>]*value="914360692"/);
    expect(html).toContain("Switched on");
  });
});
