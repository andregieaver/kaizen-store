/**
 * A tool's short title, its name in words (D438): the owner MCP's catalogue shows it, and a change kept for the person's yes that has no
 * words of its own is named by it (D439). Apart from `mcp-catalogue.ts`, which reads the owner tools, so the tools' own module can use it.
 * Pure.
 */

/** Words a title writes in capitals. */
const CAPITALS: Record<string, string> = { ai: "AI", dns: "DNS", oss: "OSS", vat: "VAT", seo: "SEO", sku: "SKU", ucp: "UCP" };
const TITLES: Record<string, string> = {
  verify_domain_for: "Verify a domain for a service",
  start_dns_move_here: "Look at moving DNS here",
  ask_store_assistant: "Ask the store's assistant",
};

/** A tool's short title: its name in words, such as `list_products` → List products. */
export function toolTitle(name: string): string {
  if (Object.hasOwn(TITLES, name)) return TITLES[name];
  // An app's tool (`app__warehouse__book_pickup`, D363) has empty parts: they are no words.
  const words = name
    .split("_")
    .filter(Boolean)
    .map((w) => (Object.hasOwn(CAPITALS, w) ? CAPITALS[w] : w));
  if (words.length === 0) return name;
  return [words[0].charAt(0).toUpperCase() + words[0].slice(1), ...words.slice(1)].join(" ");
}
