import { describe, expect, it } from "vitest";

import { articlePath, authorProblems, blogOfArticle, blogPath, blogProblems, blogTitle, feedPath, handleFromTitle, inBlog, type Blog } from "./blogs";
import { isSafeAddress } from "./field-parts";
import { SCHEDULE_LATEST_DAYS, scheduleInstant, wallClock } from "./page-schedules";
import { articleJsonLd } from "./structured-data";

/** Blogs, their addresses and authors (D341), and the schedule's time on the store's clock. */

const blog = (o: Partial<Blog>): Blog => ({ id: "b0", handle: "blog", main: false, titles: {}, listingPageId: null, comments: "moderated", position: 0, ...o });
const main = blog({ id: "main", handle: "blog", main: true });
const news = blog({ id: "news", handle: "news", titles: { "nb-NO": "Nyheter", "en-GB": "News" } });

describe("a blog's addresses", () => {
  it("keeps the first blog at /blog and puts the others at /blogs/{handle}, with the feed after each", () => {
    expect(blogPath(main)).toBe("/blog");
    expect(blogPath(news)).toBe("/blogs/news");
    expect(articlePath(main, "hello")).toBe("/blog/hello");
    expect(articlePath(news, "hello")).toBe("/blogs/news/hello");
    expect(feedPath(main)).toBe("/blog/feed.atom");
    expect(feedPath(news)).toBe("/blogs/news/feed.atom");
  });

  it("puts an article in the blog it names, else (none, or one that is gone) in the first", () => {
    expect(blogOfArticle([main, news], { blogId: "news" })).toBe(news);
    expect(blogOfArticle([main, news], {})).toBe(main);
    expect(blogOfArticle([main, news], { blogId: "gone" })).toBe(main);
    expect(inBlog([main, news], main, { blogId: "gone" })).toBe(true);
    expect(inBlog([main, news], news, {})).toBe(false);
  });

  it("names a blog in the shopper's language, else the main language's, else the standard word", () => {
    expect(blogTitle(news, "en-GB", "nb-NO", "Blog")).toBe("News");
    expect(blogTitle(news, "sv-SE", "nb-NO", "Blogg")).toBe("Nyheter");
    expect(blogTitle(main, "sv-SE", "nb-NO", "Blogg")).toBe("Blogg");
  });
});

describe("a blog as typed", () => {
  const input = { handle: "news", titles: { "nb-NO": "Nyheter" }, comments: "moderated", listingPageId: null };
  it("takes a well-formed address of its own and a comments setting", () => {
    expect(blogProblems(input, { main: false, others: ["blog"], count: 1 })).toEqual([]);
    expect(blogProblems({ ...input, handle: "" }, { main: false, others: [], count: 1 })).toEqual(["handle_missing"]);
    expect(blogProblems({ ...input, handle: "Our News" }, { main: false, others: [], count: 1 })).toEqual(["handle_format"]);
    expect(blogProblems(input, { main: false, others: ["news"], count: 1 })).toEqual(["handle_taken"]);
    expect(blogProblems({ ...input, comments: "sometimes" }, { main: false, others: [], count: 1 })).toEqual(["comments"]);
    expect(blogProblems(input, { main: false, others: [], count: 20 })).toEqual(["too_many"]);
  });

  it("never asks the first blog for an address: it stays /blog", () => {
    expect(blogProblems({ ...input, handle: "" }, { main: true, others: [], count: 0 })).toEqual([]);
  });

  it("makes an address from a title", () => {
    expect(handleFromTitle("Våre nyheter & tips!")).toBe("vare-nyheter-tips");
    expect(handleFromTitle("Ærlig talt")).toBe("aerlig-talt");
  });
});

describe("an author as typed", () => {
  it("needs a name and takes only a safe link", () => {
    expect(authorProblems({ name: "Kari", bio: "", link: "https://kari.example" }, { count: 0, safe: isSafeAddress })).toEqual([]);
    expect(authorProblems({ name: "Kari", bio: "", link: "/om-oss" }, { count: 0, safe: isSafeAddress })).toEqual([]);
    expect(authorProblems({ name: " ", bio: "", link: "javascript:alert(1)" }, { count: 0, safe: isSafeAddress })).toEqual(["name_missing", "link_unsafe"]);
  });
});

describe("a schedule on the store's clock", () => {
  const now = new Date("2026-10-27T10:00:00Z");

  it("reads a day and time in the store's time zone, summer and winter", () => {
    // Oslo is UTC+1 in winter: 09:00 on 2 November is 08:00 UTC.
    const winter = scheduleInstant("2026-11-02", "09:00", "Europe/Oslo", now);
    expect(winter).toEqual({ ok: true, at: new Date("2026-11-02T08:00:00Z") });
    // And UTC+2 in summer.
    const summer = scheduleInstant("2027-06-01", "09:00", "Europe/Oslo", now);
    expect(summer).toEqual({ ok: true, at: new Date("2027-06-01T07:00:00Z") });
    expect(scheduleInstant("2026-11-02", "09:00", "Europe/Helsinki", now)).toEqual({ ok: true, at: new Date("2026-11-02T07:00:00Z") });
  });

  it("refuses a time that is no time, in the past or too soon, and too far ahead", () => {
    expect(scheduleInstant("2026-13-02", "09:00", "Europe/Oslo", now)).toEqual({ ok: false, problem: "not_a_time" });
    expect(scheduleInstant("2026-11-02", "25:00", "Europe/Oslo", now)).toEqual({ ok: false, problem: "not_a_time" });
    expect(scheduleInstant("2026-10-27", "11:00", "Europe/Oslo", now)).toEqual({ ok: false, problem: "too_soon" });
    expect(scheduleInstant("2026-10-26", "12:00", "Europe/Oslo", now)).toEqual({ ok: false, problem: "too_soon" });
    const far = new Date(now.getTime() + (SCHEDULE_LATEST_DAYS + 2) * 86_400_000).toISOString().slice(0, 10);
    expect(scheduleInstant(far, "09:00", "Europe/Oslo", now)).toEqual({ ok: false, problem: "too_late" });
  });

  it("writes an instant back as the store's day and time", () => {
    expect(wallClock("2026-11-02T08:00:00Z", "Europe/Oslo")).toEqual({ day: "2026-11-02", time: "09:00" });
    expect(wallClock("2026-10-27T23:30:00Z", "Europe/Oslo")).toEqual({ day: "2026-10-28", time: "00:30" });
  });
});

describe("an article's author in its structured data", () => {
  const base = {
    origin: "https://kopp.example",
    url: "https://kopp.example/blog/hello",
    title: "Hello",
    description: "About hello",
    image: null,
    publishedAt: "2026-10-01T08:00:00.000Z",
    modifiedAt: "2026-10-02T08:00:00.000Z",
    locale: "nb-NO",
    store: { homeUrl: "https://kopp.example/", storeUrl: "https://kopp.example/" },
  };

  it("is the author record as a Person with their page, picture and words", () => {
    const ld = articleJsonLd({ ...base, author: { name: "Kari Nordmann", url: "/om-kari", image: "/media/kari.webp", description: "Writes about coffee." } });
    expect(ld.author).toEqual({
      "@type": "Person",
      name: "Kari Nordmann",
      url: "https://kopp.example/om-kari",
      image: "https://kopp.example/media/kari.webp",
      description: "Writes about coffee.",
    });
  });

  it("leaves out a link that is not a web address or a path, and falls back to the typed name, then the store", () => {
    expect(articleJsonLd({ ...base, author: { name: "Kari", url: "javascript:alert(1)" } }).author).toEqual({ "@type": "Person", name: "Kari" });
    expect(articleJsonLd({ ...base, author: "Ola" }).author).toEqual({ "@type": "Person", name: "Ola" });
    expect(articleJsonLd({ ...base, author: null }).author).toEqual({ "@id": expect.stringContaining("kopp.example") });
  });
});
