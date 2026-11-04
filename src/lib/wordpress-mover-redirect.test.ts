import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const MOVER_PHP = path.join(process.cwd(), "wordpress-plugin/kaizen-store/includes/class-kaizen-store-mover.php");
const hasPhp = spawnSync("php", ["-v"]).status === 0;

/**
 * The plugin's *Send shoppers to the new shop* (D446 step 4) run in PHP against stand-ins for WordPress's and WooCommerce's functions: where
 * a product, a category, the shop, the cart and the checkout lead, and that any other page stays.
 */
function redirectOf(page: { kind: "product" | "category" | "shop" | "cart" | "checkout" | "page"; slug?: string; name?: string }): string | null {
  const script = `define('ABSPATH', '/');
    $page = json_decode(stream_get_contents(STDIN), true);
    function get_option($k, $d = '') { return 'kaizen_store_mover_shop' === $k ? 'https://shop.example/s/kari/no/' : $d; }
    function untrailingslashit($s) { return rtrim($s, '/'); }
    function is_product() { global $page; return 'product' === $page['kind']; }
    function is_product_category() { global $page; return 'category' === $page['kind']; }
    function is_shop() { global $page; return 'shop' === $page['kind']; }
    function is_cart() { global $page; return 'cart' === $page['kind']; }
    function is_checkout() { global $page; return 'checkout' === $page['kind']; }
    function get_queried_object_id() { return 1; }
    function get_queried_object() { global $page; return (object) array('name' => $page['name'] ?? ''); }
    function get_post_field($f, $id) { global $page; return $page['slug'] ?? ''; }
    function sanitize_title($s) { return strtolower(preg_replace('/[^a-z0-9]+/i', '-', $s)); }
    class Sent extends Exception {}
    function wp_redirect($to, $status) { echo $status . ' ' . $to; throw new Sent(); }
    require ${JSON.stringify(MOVER_PHP)};
    try { Kaizen_Store_Mover::send_to_new_shop(); echo 'stays'; } catch (Sent $e) {}`;
  const run = spawnSync("php", ["-r", script], { input: JSON.stringify(page), encoding: "utf8" });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  return run.stdout.trim() === "stays" ? null : run.stdout.trim();
}

describe("the plugin sends shoppers to the new shop once it has moved (D446 step 4)", () => {
  it.runIf(hasPhp)("leads each product and category to its page there, and the shop, cart and checkout to its front, permanently", () => {
    expect(redirectOf({ kind: "product", slug: "wool-hat" })).toBe("301 https://shop.example/s/kari/no/p/wool-hat");
    expect(redirectOf({ kind: "category", name: "Warm Hats" })).toBe("301 https://shop.example/s/kari/no/category/warm-hats");
    for (const kind of ["shop", "cart", "checkout"] as const) expect(redirectOf({ kind })).toBe("301 https://shop.example/s/kari/no");
  });

  it.runIf(hasPhp)("leaves every other page of the site where it is", () => {
    expect(redirectOf({ kind: "page" })).toBeNull();
  });
});
