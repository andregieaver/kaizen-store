import { describe, expect, it } from "vitest";

import { isBlockedAddress, isIpHost, parseReplicaUrl, resolveAddress } from "./replicate-url";

describe("addresses a replication may never reach", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // the cloud metadata service
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "2001:db8::1",
    "[::1]",
    "not an address",
  ])("blocks %s", (address) => {
    expect(isBlockedAddress(address)).toBe(true);
  });

  it.each(["8.8.8.8", "93.184.216.34", "172.32.0.1", "172.15.255.255", "2606:4700:4700::1111", "::ffff:8.8.8.8", "100.128.0.1"])(
    "allows the public address %s",
    (address) => {
      expect(isBlockedAddress(address)).toBe(false);
    },
  );

  it("knows an IP from a name", () => {
    expect(isIpHost("1.2.3.4")).toBe(true);
    expect(isIpHost("[2606:4700::1]")).toBe(true);
    expect(isIpHost("example.com")).toBe(false);
  });
});

describe("the address typed", () => {
  const read = (text: string, options?: { allowPrivate?: boolean }) => parseReplicaUrl(text, options);

  it("reads web addresses, with https for a bare name, and drops the fragment", () => {
    expect(read("https://example.com/a?b=1#top")).toMatchObject({ ok: true });
    const bare = read("example.com/landing");
    expect(bare.ok && bare.url.toString()).toBe("https://example.com/landing");
    const fragment = read("http://example.com/#x");
    expect(fragment.ok && fragment.url.hash).toBe("");
    const port = read("example.com:443/x");
    expect(port.ok && port.url.hostname).toBe("example.com");
  });

  it.each([
    "",
    "   ",
    "ftp://example.com/file",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "https://user:pass@example.com/",
    "http://localhost/",
    "http://localhost:3000/",
    "http://app.localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/admin",
    "http://intranet/",
    "http://printer.local/",
    "http://db.internal/",
    "https://example.com:8443/",
    "http://2130706433/", // 127.0.0.1 as one number: the URL parser turns it into 127.0.0.1
    "http://0x7f.1/",
    "http://017700000001/",
  ])("refuses %j", (text) => {
    expect(read(text).ok).toBe(false);
  });

  it("lets tests reach a local page, and only when asked", () => {
    expect(read("http://localhost:3000/fixture", { allowPrivate: true }).ok).toBe(true);
    expect(read("http://localhost:3000/fixture").ok).toBe(false);
    // Whatever the option, the scheme still has to be the web's.
    expect(read("file:///etc/passwd", { allowPrivate: true }).ok).toBe(false);
  });

  it("makes addresses found in a page absolute, and drops what is not a web address", () => {
    expect(resolveAddress("/img/a.png", "https://example.com/x/y")).toBe("https://example.com/img/a.png");
    expect(resolveAddress("//cdn.example.com/a.png", "https://example.com/")).toBe("https://cdn.example.com/a.png");
    expect(resolveAddress("b.png", "https://example.com/x/y")).toBe("https://example.com/x/b.png");
    for (const value of ["", "data:image/png;base64,AAA", "javascript:void(0)", "mailto:a@b.c", "tel:123", "blob:x"]) {
      expect(resolveAddress(value, "https://example.com/")).toBeNull();
    }
  });
});
