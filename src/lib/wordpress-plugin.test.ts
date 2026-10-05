import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

import { describe, expect, it } from "vitest";

import { buildPluginZip, PLUGIN_DIR, PLUGIN_ZIP, pluginFiles } from "../../scripts/wordpress-plugin-zip.mjs";

import { WORDPRESS_PLUGIN_FILE, WORDPRESS_PLUGIN_VERSION } from "./wordpress-plugin";

const read = (file: string) => readFile(path.join(PLUGIN_DIR, file), "utf8");
const API_ROUTES = path.join(import.meta.dirname, "..", "app", "api", "wordpress", "v1");

describe("the WordPress plugin (D169)", () => {
  it("is the zip in public/downloads: run `node scripts/build-wordpress-plugin.mjs` after changing the plugin", async () => {
    expect(existsSync(PLUGIN_ZIP)).toBe(true);
    const built: Buffer = await buildPluginZip();
    const kept = await readFile(PLUGIN_ZIP);
    expect(kept.equals(built)).toBe(true);
  });

  it("is offered from the file the admin page links to", () => {
    expect(path.join(import.meta.dirname, "..", "..", "public", WORDPRESS_PLUGIN_FILE)).toBe(PLUGIN_ZIP);
  });

  it("has one version everywhere: header, constant, readme and the admin page", async () => {
    const main = await read("kaizen-store.php");
    expect(main).toContain(` * Version:           ${WORDPRESS_PLUGIN_VERSION}`);
    expect(main).toContain(`define( 'KAIZEN_STORE_VERSION', '${WORDPRESS_PLUGIN_VERSION}' );`);
    expect(await read("readme.txt")).toContain(`Stable tag: ${WORDPRESS_PLUGIN_VERSION}`);
    expect(await read("readme.txt")).toContain(`= ${WORDPRESS_PLUGIN_VERSION} =`);
  });

  it("is a folder of its own in the zip, with the main file and nothing hidden or for developers", async () => {
    const files: string[] = await pluginFiles();
    expect(files).toContain("kaizen-store.php");
    expect(files).toContain("readme.txt");
    expect(files).toContain("uninstall.php");
    expect(files.some((f) => f.split("/").some((part) => part.startsWith(".")))).toBe(false);
    expect(files.some((f) => /\.(map|log|sql|env|bak|zip)$/.test(f))).toBe(false);
  });

  it("has PHP that parses (when PHP is installed) and JavaScript that parses", async () => {
    const files: string[] = await pluginFiles();
    const hasPhp = spawnSync("php", ["-v"]).status === 0;
    for (const file of files.filter((f) => f.endsWith(".php"))) {
      if (hasPhp) {
        const lint = spawnSync("php", ["-l", path.join(PLUGIN_DIR, file)], { encoding: "utf8" });
        expect(lint.status, `${file}: ${lint.stdout}${lint.stderr}`).toBe(0);
      }
      expect(await read(file), file).toMatch(/^<\?php/);
      // Every file refuses to run outside WordPress.
      expect(await read(file), file).toMatch(/defined\( '(ABSPATH|WP_UNINSTALL_PLUGIN)' \)/);
    }
    for (const file of files.filter((f) => f.endsWith(".js"))) {
      const code = await read(file);
      expect(() => new vm.Script(code, { filename: file }), file).not.toThrow();
    }
  });

  it("asks only for routes Kaizen has", async () => {
    const api = await read("includes/class-kaizen-store-api.php");
    const wanted = [...api.matchAll(/(?:request\(\s*'(?:GET|POST|DELETE)',\s*)'([^']+)'/g)].map((m) => m[1]);
    expect(wanted.length).toBeGreaterThan(4);
    const haves = new Set<string>();
    async function walk(dir: string, prefix: string) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) await walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
        else if (entry.name === "route.ts") haves.add(prefix || "/");
      }
    }
    await walk(API_ROUTES, "");
    // `/stores/' . rawurlencode( $store ) . '/terms` is the route `/stores/[slug]/terms`.
    expect([...haves].sort()).toEqual(expect.arrayContaining(["/token", "/connection", "/stores", "/stores/[slug]/terms", "/stores/[slug]/products", "/stores/[slug]/view", "/stores/[slug]/product", "/stores/[slug]/cart/quote", "/stores/[slug]/cart/handoff"]));
    for (const path of ["/token", "/connection", "/stores"]) expect(wanted).toContain(path);
    expect(api).toContain("'/stores/' . rawurlencode( $store ) . '/terms'");
    expect(api).toContain("'/stores/' . rawurlencode( $store ) . '/products'");
    expect(api).toContain("'/stores/' . rawurlencode( $store ) . '/view'");
    expect(api).toContain("'/stores/' . rawurlencode( $store ) . '/product'");
    expect(api).toContain("'/stores/' . rawurlencode( $store ) . '/cart/quote'");
    expect(api).toContain("'/stores/' . rawurlencode( $store ) . '/cart/handoff'");
  });

  it("speaks the approval's words: the request Kaizen reads and the answer it gives back", async () => {
    const connect = await read("includes/class-kaizen-store-connect.php");
    for (const word of ["/admin/account/wordpress/connect", "'site'", "'name'", "'return'", "'state'", "'challenge'", "kaizen_state", "kaizen_code", "kaizen_error"]) expect(connect, word).toContain(word);
    const lib = await readFile(path.join(import.meta.dirname, "wordpress.ts"), "utf8");
    for (const word of ["kaizen_state", "kaizen_code", "kaizen_error", `"site"`, `"return"`, `"state"`, `"challenge"`]) expect(lib, word).toContain(word);
    // The same challenge: base64url of the SHA-256 of the verifier.
    expect(connect).toContain("hash( 'sha256', $verifier, true )");
  });

  it("registers its scripts at init (block themes draw content before they queue scripts) and never trusts the browser's lines", async () => {
    const shortcode = await read("includes/class-kaizen-store-shortcode.php");
    expect(shortcode).toContain("add_action( 'init', array( __CLASS__, 'register_assets' ) )");
    expect(shortcode).not.toMatch(/add_action\( 'wp_enqueue_scripts', array\( __CLASS__, 'register_assets' \) \)/);
    const rest = await read("includes/class-kaizen-store-rest.php");
    // The cart route validates variants, quantities and the store before Kaizen is asked, and counts calls per address.
    for (const word of ["stores_in_use()", "Kaizen_Store_Views::UUID", "$quantity > 20", "count( $lines ) > 30", "allowed( 'quote'", "allowed( 'checkout'"]) expect(rest, word).toContain(word);
  });

  it("speaks the cart's words: what the script reads from Kaizen's answers exists in them", async () => {
    const script = await read("assets/cart.js");
    const lib = await readFile(path.join(import.meta.dirname, "wordpress-cart.ts"), "utf8");
    for (const label of [...script.matchAll(/labels\(\)\.([a-zA-Z]+)/g)].map((m) => m[1]).filter((name) => name !== "loading").concat(["cart", "checkout", "subtotal", "addToCart", "emptyCart"])) {
      expect(lib, `label ${label}`).toMatch(new RegExp(`\\b${label}\\b`));
    }
    for (const field of ["subtotal_text", "vat_label", "line_text", "available", "variant_id"]) expect(script, field).toContain(field);
  });

  it("never prints what it was not given unescaped, and never reads the superglobals unchecked", async () => {
    const files: string[] = await pluginFiles();
    for (const file of files.filter((f) => f.endsWith(".php") && f !== "uninstall.php")) {
      const code = await read(file);
      // Output of a variable goes through an escaping function.
      for (const match of code.matchAll(/echo\s+\$[a-zA-Z_]+/g)) expect.soft(match[0], `${file}: ${match[0]}`).toBeUndefined();
      // A superglobal is read only where its line sanitizes, unslashes or is marked as checked elsewhere.
      for (const line of code.split("\n").filter((l) => /\$_(GET|POST|REQUEST)\b/.test(l))) {
        expect.soft(/sanitize_|wp_unslash|preg_replace|\(int\)|isset\(|esc_url_raw|phpcs:ignore|phpcs:disable/.test(line), `${file}: ${line.trim()}`).toBe(true);
      }
    }
  });
});
