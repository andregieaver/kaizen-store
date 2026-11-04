import { describe, expect, it } from "vitest";

import { addressesToMove, dnsHostOf, leadsToShopify } from "./shopify-address";

describe("the Shopify shop's address", () => {
  it("moves the shop's own domain and its other name, never a myshopify.com one", () => {
    expect(addressesToMove("www.minbutikk.no")).toEqual(["www.minbutikk.no", "minbutikk.no"]);
    expect(addressesToMove("minbutikk.no.")).toEqual(["minbutikk.no", "www.minbutikk.no"]);
    expect(addressesToMove("shop.minbutikk.no")).toEqual(["shop.minbutikk.no"]);
    expect(addressesToMove("www.shop.co.uk")).toEqual(["www.shop.co.uk", "shop.co.uk"]);
    expect([addressesToMove("min-butikk.myshopify.com"), addressesToMove(null), addressesToMove("localhost")]).toEqual([[], [], []]);
  });

  it("tells where the DNS is kept from the nameservers", () => {
    expect(dnsHostOf(["ns1.vercel-dns.com", "ns2.vercel-dns.com"])).toBe("kaizena");
    expect(dnsHostOf(["NS1.SHOPIFY.COM."])).toBe("shopify");
    expect(dnsHostOf(["ada.ns.cloudflare.com"])).toBe("cloudflare");
    expect(dnsHostOf(["ns51.domaincontrol.com"])).toBe("godaddy");
    expect(dnsHostOf(["dns1.registrar-servers.com"])).toBe("namecheap");
    expect(dnsHostOf(["ns1.hyp.net"])).toBe("domeneshop");
    expect(dnsHostOf(["ns01.one.com"])).toBe("one_com");
    expect(dnsHostOf(["ns-cloud-a1.googledomains.com"])).toBe("squarespace");
    expect(dnsHostOf(["ns1.example-dns.net"])).toBe("other");
    expect(dnsHostOf([])).toBe("unknown");
    // A name that only looks like one is not it.
    expect(dnsHostOf(["ns1.notshopify.com"])).toBe("other");
  });

  it("sees an address still answering from Shopify", () => {
    expect(leadsToShopify(["23.227.38.65"], null)).toBe(true);
    expect(leadsToShopify([], "shops.myshopify.com.")).toBe(true);
    expect(leadsToShopify(["76.76.21.21"], null)).toBe(false);
    expect(leadsToShopify(["123.227.38.65"], "cname.vercel-dns.com")).toBe(false);
  });
});
