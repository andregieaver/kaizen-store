/**
 * The part of a caller's address a budget counts (D439 review): an IPv4 address whole, an IPv6 address by its /64 (one household or
 * server is given a whole /64, so counting each address in it would let one caller be millions), an IPv4 address written as IPv6
 * (`::ffff:1.2.3.4`) as the IPv4 one. Brackets and a zone (`%eth0`) are dropped. What cannot be read is counted as it is written.
 */
export function addressPrefix(raw: string): string {
  const value = raw.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase();
  if (!value.includes(":")) return value;
  const groups = expandIpv6(value);
  if (!groups) return value;
  if (groups.slice(0, 5).every((g) => g === "0000") && groups[5] === "ffff") {
    const [a, b] = [parseInt(groups[6], 16), parseInt(groups[7], 16)];
    return [a >> 8, a & 255, b >> 8, b & 255].join(".");
  }
  return `${groups.slice(0, 4).join(":")}::/64`;
}

/** The eight groups of an IPv6 address, each as four hex digits; null for what is not one. */
function expandIpv6(value: string): string[] | null {
  let text = value;
  // An IPv4 tail (`::1.2.3.4`) becomes its two groups.
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (tail) {
    const bytes = tail.slice(1).map(Number);
    if (bytes.some((b) => b > 255)) return null;
    text = `${text.slice(0, tail.index)}${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...rest];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.map((g) => g.padStart(4, "0"));
}
