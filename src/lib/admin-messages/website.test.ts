import { describe, expect, it } from "vitest";

import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { PAGE_ROLES, ROLE_COPY, ROLE_GROUPS } from "@/lib/page-roles";

import { websiteEn } from "./website.en";
import { websiteNb } from "./website.nb";

/** The store's page lists (D312): their English is the libraries' own, and Norwegian has every word of it. */
describe("the store's page lists", () => {
  it("say each place's standard page and hint as ROLE_COPY does, and name it as the list does", () => {
    for (const role of PAGE_ROLES) {
      expect(websiteEn.storePages.roles[role]).toEqual({ standard: ROLE_COPY[role].standard, hint: ROLE_COPY[role].hint });
      expect(websiteEn.list.roles[role]).toBe(ROLE_COPY[role].name);
      expect(websiteNb.storePages.roles[role].hint.length).toBeGreaterThan(20);
    }
  });

  it("have a word for every group of places", () => {
    for (const group of ROLE_GROUPS) {
      expect((websiteEn.storePages.groups as Record<string, string>)[group.name]).toBe(group.name);
      expect((websiteNb.storePages.groups as Record<string, string>)[group.name]).toBeTruthy();
    }
  });

  it("name each kind of page as the admin's lists do", () => {
    for (const [type, copy] of Object.entries(PAGE_TYPE_COPY)) {
      const words = websiteEn.storePages.types[type as keyof typeof PAGE_TYPE_COPY];
      expect(words.list).toBe(copy.list);
      expect(words.many).toBe(copy.many);
      expect(words.new).toBe(`New ${copy.one}`);
    }
  });
});
