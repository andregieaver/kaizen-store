import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { canonicalQuery, isMoverSecret, moverHeaders, moverSignature, openMoverState, pluginsOf, redirectLinesOf, sealMoverState, seoOf, subscriberLinesOf } from "./woocommerce-mover";

const SECRET = "a".repeat(64);
const MOVER_PHP = path.join(process.cwd(), "wordpress-plugin/kaizen-store/includes/class-kaizen-store-mover.php");
const hasPhp = spawnSync("php", ["-v"]).status === 0;

/** The plugin's own `verify()`, run in PHP with the class as it ships. */
function phpVerify(input: { secret: string; time: string; signature: string; route: string; query: Record<string, string>; now: number }): boolean {
  const script = `define('ABSPATH', '/'); require ${JSON.stringify(MOVER_PHP)}; $i = json_decode(stream_get_contents(STDIN), true);
    echo Kaizen_Store_Mover::verify($i['secret'], $i['time'], $i['signature'], 'GET', $i['route'], $i['query'], $i['now']) ? 'yes' : 'no';`;
  const run = spawnSync("php", ["-r", script], { input: JSON.stringify(input), encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr);
  return run.stdout.trim() === "yes";
}

describe("the mover's signature (D446 step 2)", () => {
  it("signs the time, method, route and the query sorted and encoded as RFC 3986", () => {
    expect(canonicalQuery({ page: 2, ids: "11,12", a: "x y!" })).toBe("a=x%20y%21&ids=11%2C12&page=2");
    const headers = moverHeaders(SECRET, 1_793_800_000, "/kaizena-mover/v1/seo", { ids: "11,12" });
    expect(headers["X-Kaizena-Mover-Time"]).toBe("1793800000");
    expect(headers["X-Kaizena-Mover-Signature"]).toBe(moverSignature(SECRET, 1_793_800_000, "GET", "/kaizena-mover/v1/seo", { ids: "11,12" }));
    expect(headers["X-Kaizena-Mover-Signature"]).toMatch(/^[a-f0-9]{64}$/);
    expect(isMoverSecret(SECRET)).toBe(true);
    expect(isMoverSecret("short")).toBe(false);
  });

  it.runIf(hasPhp)("is accepted by the plugin's own PHP as made, and refused altered, late or without a secret", () => {
    const time = 1_793_800_000;
    const query = { ids: "11,12", page: "1" };
    const signature = moverSignature(SECRET, time, "GET", "/kaizena-mover/v1/seo", query);
    const base = { secret: SECRET, time: String(time), signature, route: "/kaizena-mover/v1/seo", query, now: time + 10 };
    expect(phpVerify(base)).toBe(true);
    // The plugin reads the query in any order: it sorts as we do.
    expect(phpVerify({ ...base, query: { page: "1", ids: "11,12" } })).toBe(true);
    expect(phpVerify({ ...base, query: { ids: "11,13", page: "1" } })).toBe(false);
    expect(phpVerify({ ...base, route: "/kaizena-mover/v1/subscribers" })).toBe(false);
    expect(phpVerify({ ...base, now: time + 301 })).toBe(false);
    expect(phpVerify({ ...base, secret: "" })).toBe(false);
    expect(phpVerify({ ...base, secret: "b".repeat(64) })).toBe(false);
  });
});

describe("the note of Connect the plugin", () => {
  const key = Buffer.alloc(32, 3);
  const value = { nonce: "n".repeat(32), store: "kari", account: "00000000-0000-4000-8000-000000000001", site: "myshop.com" };

  it("opens only as signed here, unaltered and in time", () => {
    const now = Date.UTC(2026, 10, 4, 12);
    const sealed = sealMoverState(key, value, now);
    expect(openMoverState(key, sealed, now)).toMatchObject(value);
    expect(openMoverState(key, sealed, now + 61 * 60_000)).toBeNull();
    expect(openMoverState(Buffer.alloc(32, 4), sealed, now)).toBeNull();
    expect(openMoverState(key, `${sealed}x`, now)).toBeNull();
  });
});

describe("the plugin's answers, read", () => {
  it("names the shop's plugins", () => {
    expect(pluginsOf({ plugins: [{ slug: "mailpoet", name: "MailPoet" }, { slug: "../bad", name: "x" }, { slug: "woocommerce", name: "WooCommerce\u0007" }] })).toEqual([
      { slug: "mailpoet", name: "MailPoet" },
      { slug: "woocommerce", name: "WooCommerce" },
    ]);
    expect(pluginsOf("nonsense")).toEqual([]);
  });

  it("keeps exact redirects and leaves patterns", () => {
    const read = redirectLinesOf({
      redirects: [
        { source: "redirection", from: "/old-hat/", to: "/product/wool-hat/", regex: false },
        { source: "rank-math", from: "/sale/(.*)", to: "/shop/", regex: true },
        { source: "yoast", from: "no-slash", to: "/x/", regex: false },
        { source: "yoast", from: "/same/", to: "/same/", regex: false },
      ],
      more: true,
    });
    expect(read).toEqual({ lines: [{ id: "woo-redirect-redirection-0", path: "/old-hat/", target: "/product/wool-hat/" }], skipped: 3, more: true });
  });

  it("keeps a product's own SEO words and leaves the plugin's variables", () => {
    const seo = seoOf({ seo: [{ id: 11, title: "Wool hat | Kari", description: "Warm." }, { id: 12, title: "%%title%% %%sep%% %%sitename%%", description: "" }, { id: "x", title: "y" }] });
    expect([...seo]).toEqual([[11, { title: "Wool hat | Kari", description: "Warm." }]]);
  });

  it("takes MailPoet's subscribed subscribers with their day, confirmed when MailPoet says so", () => {
    const read = subscriberLinesOf({
      subscribers: [
        { email: "Kari@Example.com", first_name: "Kari", last_name: "N", status: "subscribed", subscribed_at: "2025-03-02 10:00:00", created_at: "2025-03-01 09:00:00", confirmed_at: "2025-03-02 10:05:00" },
        { email: "ola@example.com", first_name: "Ola", last_name: "", status: "subscribed", subscribed_at: null, created_at: "2024-01-01 00:00:00", confirmed_at: null },
        { email: "gone@example.com", status: "unsubscribed", created_at: "2024-01-01 00:00:00" },
        { email: "unconfirmed@example.com", status: "unconfirmed", created_at: "2024-01-01 00:00:00" },
      ],
      more: false,
    });
    expect(read).toEqual({
      more: false,
      lines: [
        { email: "kari@example.com", name: "Kari N", state: "SUBSCRIBED", level: "CONFIRMED_OPT_IN", updatedAt: "2025-03-02T10:00:00.000Z" },
        { email: "ola@example.com", name: "Ola", state: "SUBSCRIBED", level: "SINGLE_OPT_IN", updatedAt: "2024-01-01T00:00:00.000Z" },
      ],
    });
  });
});
