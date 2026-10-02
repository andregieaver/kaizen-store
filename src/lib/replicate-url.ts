/**
 * Which addresses the page replicator (D150) may open. It fetches pages and files for a person, from Kaizen's server,
 * so an address must never reach Kaizen's own network, a database, a cloud metadata service or a person's computer:
 * only `http` and `https` on their usual ports, to a name that is not the machine's own, whose every address
 * (`isBlockedAddress()`) is a public one. The pure rules are here; the server asks the name system and applies them
 * at every step, redirects and the browser's own requests too (`src/server/replicate-fetch.ts`).
 */

export const REPLICA_URL_MAX = 2000;
/** The ports a page is fetched from. */
const PORTS = new Set(["", "80", "443"]);

export type ReplicaUrl = { ok: true; url: URL } | { ok: false; problem: string };

/** Names that mean the machine itself or a private network, whatever they resolve to. */
function internalName(host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, "");
  return (
    name === "localhost" ||
    name.endsWith(".localhost") ||
    name.endsWith(".local") ||
    name.endsWith(".internal") ||
    name.endsWith(".intranet") ||
    name.endsWith(".lan") ||
    name.endsWith(".home.arpa") ||
    !name.includes(".") && !name.includes(":")
  );
}

/** The four numbers of a dotted IPv4 address, or null. */
function ipv4(text: string): number[] | null {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (!match) return null;
  const parts = match.slice(1).map(Number);
  return parts.every((part) => part <= 255) ? parts : null;
}

/** The eight 16-bit groups of an IPv6 address, or null when it is not one. */
function ipv6(text: string): number[] | null {
  let value = text.toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
  value = value.replace(/%.*$/, "");
  if (!value.includes(":")) return null;
  // An IPv4 tail (::ffff:10.0.0.1) is two groups.
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (tail) {
    const four = ipv4(tail[1]);
    if (!four) return null;
    value = value.slice(0, value.length - tail[1].length) + `${((four[0] << 8) | four[1]).toString(16)}:${((four[2] << 8) | four[3]).toString(16)}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] === "" ? [] : halves[0].split(":");
  const right = halves.length === 2 ? (halves[1] === "" ? [] : halves[1].split(":")) : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? left.length !== 8 : missing < 1) return null;
  const groups = [...left, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...right];
  if (groups.length !== 8 || !groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => parseInt(group, 16));
}

/** Whether an IPv4 address is not a public one: private, loopback, link-local (cloud metadata), carrier-grade NAT, test, multicast or reserved. */
function blockedV4([a, b, c]: number[]): boolean {
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

/** Whether an address (IPv4 or IPv6, as text) is one a replication may never reach: anything that is not a public address. */
export function isBlockedAddress(address: string): boolean {
  const four = ipv4(address);
  if (four) return blockedV4(four);
  const groups = ipv6(address);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // ::, ::1, and IPv4-mapped (::ffff:a.b.c.d) or compatible (::a.b.c.d) addresses take the IPv4 rules.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    if (g5 === 0xffff || g5 === 0) {
      if (g5 === 0 && g6 === 0 && g7 <= 1) return true;
      return blockedV4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
    }
  }
  // NAT64 (64:ff9b::/96) carries an IPv4 address too.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return blockedV4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  // Unique local (fc00::/7), link-local (fe80::/10), site-local (fec0::/10), multicast (ff00::/8), documentation (2001:db8::/32).
  if ((g0 & 0xfe00) === 0xfc00 || (g0 & 0xffc0) === 0xfe80 || (g0 & 0xffc0) === 0xfec0 || (g0 & 0xff00) === 0xff00) return true;
  if (g0 === 0x2001 && g1 === 0xdb8) return true;
  return false;
}

/** Whether a host written in an address is a number (an IP, however it is written) rather than a name. */
export const isIpHost = (host: string): boolean => ipv4(host) !== null || ipv6(host) !== null;

/**
 * An address a person typed, read: `http` or `https`, no sign-in details, the usual ports, and a name that is not the
 * machine's own. A bare name (`example.com/page`) is read as `https`. The names this does not catch (a public name that
 * resolves to a private address) are caught when the name is looked up.
 */
export function parseReplicaUrl(raw: string, options: { allowPrivate?: boolean } = {}): ReplicaUrl {
  const text = raw.trim();
  if (text === "") return { ok: false, problem: "Type the address of the page to copy." };
  if (text.length > REPLICA_URL_MAX) return { ok: false, problem: "That address is too long." };
  const given = /^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^/]*:\d+(\/|$)/.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return { ok: false, problem: "That is not an address I can open. Write it like https://example.com/page." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, problem: "Only web addresses (http or https) can be copied." };
  if (url.username || url.password) return { ok: false, problem: "Leave out the user name and password; only pages anyone can open can be copied." };
  if (!options.allowPrivate) {
    if (!PORTS.has(url.port)) return { ok: false, problem: "Only pages on the usual web ports can be copied." };
    const host = url.hostname;
    if (isIpHost(host) ? isBlockedAddress(host) : internalName(host)) {
      return { ok: false, problem: "That address is on a private network or this machine; only public web pages can be copied." };
    }
  }
  url.hash = "";
  return { ok: true, url };
}

/** The address of a file or page found in a page, made absolute against the page, or null if it is not a web address. */
export function resolveAddress(value: string, base: string): string | null {
  const text = value.trim();
  if (text === "" || /^(javascript|data|blob|about|mailto|tel):/i.test(text)) return null;
  try {
    const url = new URL(text, base);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}
