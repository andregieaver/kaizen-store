import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  dnsFound,
  dnsRecordFor,
  embedFrameHeaders,
  embedTag,
  framingHosts,
  mayFrame,
  mayRecheck,
  normalizeHost,
  privacyUrlFor,
  tagFoundIn,
} from "./support-embed";

const KEY = "abcdefghij0123456789";

describe("the chat on an owner's own website (D581)", () => {
  it("reads a host from what the owner typed or pasted", () => {
    expect(normalizeHost("Example.com")).toBe("example.com");
    expect(normalizeHost("  https://www.Example.com/contact?x=1 ")).toBe("www.example.com");
    expect(normalizeHost("www.example.com.")).toBe("www.example.com");
    expect(normalizeHost("http://blog.example.co.uk")).toBe("blog.example.co.uk");
    for (const bad of ["", "example", "localhost", "my.localhost", "printer.local", "10.0.0.1", "[::1]", "example.com:8080", "https://user:pw@example.com", "ftp://example.com", "/contact", "ex ample.com"]) {
      expect(normalizeHost(bad), bad).toBeNull();
    }
  });

  it("lets a site's www twin frame its chat, and nothing else", () => {
    expect(framingHosts("example.com")).toEqual(["example.com", "www.example.com"]);
    expect(framingHosts("www.example.com")).toEqual(["www.example.com", "example.com"]);
    expect(mayFrame("example.com", "www.example.com")).toBe(true);
    expect(mayFrame("example.com", "shop.example.com")).toBe(false);
    expect(mayFrame("example.com", "example.com.evil.net")).toBe(false);
  });

  it("takes a privacy page only as https on the site itself", () => {
    expect(privacyUrlFor("example.com", "")).toBeNull();
    expect(privacyUrlFor("example.com", "/privacy")).toBe("https://example.com/privacy");
    expect(privacyUrlFor("example.com", "https://www.example.com/privacy")).toBe("https://www.example.com/privacy");
    expect(privacyUrlFor("example.com", "http://example.com/privacy")).toBe("invalid");
    expect(privacyUrlFor("example.com", "https://other.net/privacy")).toBe("invalid");
    expect(privacyUrlFor("example.com", "javascript:alert(1)")).toBe("invalid");
  });

  it("finds the tag with the site's own key, and only as the loader's script", () => {
    const tag = embedTag("https://kaizenaflow.com", KEY);
    expect(tag).toBe(`<script src="https://kaizenaflow.com/embed/chat.js" data-key="${KEY}" async></script>`);
    expect(tagFoundIn(`<html><body>…${tag}</body></html>`, KEY)).toBe(true);
    expect(tagFoundIn(`<script async data-key='${KEY}' src='//kaizenaflow.com/embed/chat.js'></script>`, KEY)).toBe(true);
    expect(tagFoundIn(`<script src="https://kaizenaflow.com/embed/chat.js" data-key="${"z".repeat(20)}"></script>`, KEY)).toBe(false);
    expect(tagFoundIn(`<p>${KEY}</p><script src="/other.js"></script>`, KEY)).toBe(false);
    expect(tagFoundIn(`<script src="https://kaizenaflow.com/embed/chat.js" data-key="${KEY}x"></script>`, KEY)).toBe(false);
    expect(tagFoundIn(tag, "not a key")).toBe(false);
  });

  it("finds the DNS record a tag manager's site adds instead", () => {
    expect(dnsRecordFor(KEY)).toBe(`kaizena-flow-chat=${KEY}`);
    expect(dnsFound([["v=spf1 -all"], ["kaizena-flow-chat=", KEY]], KEY)).toBe(true);
    expect(dnsFound([["kaizena-flow-chat=other"]], KEY)).toBe(false);
  });

  it("checks a site not yet found again at most every ten minutes", () => {
    const now = Date.parse("2026-11-13T12:00:00Z");
    expect(mayRecheck(null, now)).toBe(true);
    expect(mayRecheck("2026-11-13T11:55:00Z", now)).toBe(false);
    expect(mayRecheck("2026-11-13T11:50:00Z", now)).toBe(true);
  });

  it("lets only the page's own host frame the chat, on an address of the right shape", () => {
    const [rule] = embedFrameHeaders();
    expect(rule.headers).toEqual([{ key: "Content-Security-Policy", value: "frame-ancestors https://:host" }]);
    expect(rule.source).toBe("/embed/chat/:key([a-z0-9]{20})/:host([a-z0-9.-]{4,253})");
  });

  it("ships a loader that frames only from its own origin and listens only to its frame", () => {
    const loader = readFileSync(path.join(process.cwd(), "public/embed/chat.js"), "utf8");
    expect(loader).toContain('"/embed/chat/" + key + "/" + host');
    expect(loader).toContain("event.origin !== origin || event.source !== frame.contentWindow");
    expect(loader).toContain('location.protocol !== "https:"');
    expect(loader).not.toMatch(/document\.cookie|localStorage|innerHTML|eval\(/);
  });
});
