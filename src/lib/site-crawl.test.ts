import { describe, expect, it } from "vitest";

import { crawlDue, linksIn, robotsAllow, robotsRules, robotsSitemaps, sitePath } from "./site-crawl";

describe("reading a chat widget's websites (D583)", () => {
  it("reads robots.txt for our agent first, else for anyone", () => {
    const text = `# hello
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /private/
Allow: /private/press
Disallow: /*.pdf$

Sitemap: https://www.example.com/sitemap_index.xml`;
    const anyone = robotsRules(text);
    expect(robotsAllow(anyone, "/")).toBe(true);
    expect(robotsAllow(anyone, "/private/staff")).toBe(false);
    expect(robotsAllow(anyone, "/private/press")).toBe(true);
    expect(robotsAllow(anyone, "/files/a.pdf")).toBe(false);
    expect(robotsAllow(anyone, "/files/a.pdf/x")).toBe(true);
    expect(robotsSitemaps(text)).toEqual(["https://www.example.com/sitemap_index.xml"]);

    const ours = robotsRules(`User-agent: *\nDisallow: /\n\nUser-agent: KaizenaFlowBot\nUser-agent: Other\nAllow: /\nDisallow: /cart`);
    expect(robotsAllow(ours, "/about")).toBe(true);
    expect(robotsAllow(ours, "/cart")).toBe(false);
    expect(robotsAllow(robotsRules(""), "/anything")).toBe(true);
    expect(robotsAllow(robotsRules("User-agent: *\nDisallow:"), "/anything")).toBe(true);
  });

  it("takes only pages of the site itself: its host or www twin, no file, no query, no sign-in page", () => {
    expect(sitePath("example.com", "https://www.example.com/About/")).toBe("/About");
    expect(sitePath("example.com", "https://example.com/pricing?ref=x#plans")).toBe("/pricing");
    expect(sitePath("example.com", "/contact", "https://example.com/about")).toBe("/contact");
    expect(sitePath("example.com", "team", "https://example.com/about/")).toBe("/about/team");
    expect(sitePath("example.com", "https://example.com/")).toBe("/");
    for (const bad of ["https://other.net/page", "https://shop.example.com/page", "https://example.com/brochure.pdf", "https://example.com/logo.png", "ftp://example.com/x", "https://user:pw@example.com/x", "https://example.com:8443/x", "https://example.com/wp-admin/edit", "https://example.com/my-account", "https://example.com/cart"]) {
      expect(sitePath("example.com", bad), bad).toBeNull();
    }
  });

  it("finds a page's links on the same site, each once, leaving out mail, phone, anchors and nofollow", () => {
    const html = `<a href="/about">About</a> <a href='/about#team'>Team</a> <a href="https://www.example.com/pricing/">Pricing</a>
      <a href="https://elsewhere.net/">Out</a> <a href="mailto:a@example.com">Mail</a> <a href="tel:123">Call</a> <a href="#top">Top</a>
      <a rel="nofollow" href="/login-only">Hidden</a> <a href=faq>FAQ</a> <a href="/guide.pdf">PDF</a> <a href="/a?b=1&amp;c=2">Q</a>`;
    expect(linksIn(html, "example.com", "https://example.com/help/")).toEqual(["/about", "/pricing", "/help/faq", "/a"]);
    expect(linksIn(`<base href="https://example.com/docs/"><a href="start">Start</a>`, "example.com", "https://example.com/")).toEqual(["/docs/start"]);
  });

  it("lists a site again when it never was, when the owner asked since, or a week on", () => {
    const now = Date.parse("2026-11-20T12:00:00Z");
    expect(crawlDue({ discoveredAt: null, crawlRequestedAt: null }, now)).toBe(true);
    expect(crawlDue({ discoveredAt: "2026-11-19T12:00:00Z", crawlRequestedAt: null }, now)).toBe(false);
    expect(crawlDue({ discoveredAt: "2026-11-19T12:00:00Z", crawlRequestedAt: "2026-11-20T11:00:00Z" }, now)).toBe(true);
    expect(crawlDue({ discoveredAt: "2026-11-19T12:00:00Z", crawlRequestedAt: "2026-11-18T11:00:00Z" }, now)).toBe(false);
    expect(crawlDue({ discoveredAt: "2026-11-13T12:00:00Z", crawlRequestedAt: null }, now)).toBe(true);
  });
});
