import { describe, expect, it } from "vitest";

import { addressPrefix } from "./client-address";

describe("the part of an address a budget counts (D439 review)", () => {
  it("counts IPv4 whole and an IPv6 address by its /64, however it is written", () => {
    expect(addressPrefix("203.0.113.7")).toBe("203.0.113.7");
    expect(addressPrefix("2001:db8:1:2:aaaa::1")).toBe("2001:0db8:0001:0002::/64");
    expect(addressPrefix("2001:DB8:1:2:ffff:ffff:ffff:fffe")).toBe("2001:0db8:0001:0002::/64");
    expect(addressPrefix("[2001:db8:1:2::9]")).toBe("2001:0db8:0001:0002::/64");
    expect(addressPrefix("fe80::1%eth0")).toBe("fe80:0000:0000:0000::/64");
    expect(addressPrefix("::1")).toBe("0000:0000:0000:0000::/64");
  });

  it("counts an IPv4 address written as IPv6 as the IPv4 one", () => {
    expect(addressPrefix("::ffff:198.51.100.4")).toBe("198.51.100.4");
    expect(addressPrefix("0:0:0:0:0:ffff:c633:6404")).toBe("198.51.100.4");
  });

  it("leaves what is not an address as written", () => {
    expect(addressPrefix("")).toBe("");
    expect(addressPrefix("not:an:address:::")).toBe("not:an:address:::");
    expect(addressPrefix("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
  });
});
