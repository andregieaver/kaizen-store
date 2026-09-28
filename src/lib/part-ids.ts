/**
 * Ids of a global part's uses (D98). A use's ids are the global's own ids
 * XOR one mask (128 bits, written as a uuid), the mask being the use's
 * first id XOR the global's first id. So each use of a global has ids of
 * its own, the same part has the same place in every use, a use inside
 * another global's use stays one (XOR is associative), and XOR with the
 * same mask again gives the global's ids back.
 */

const HEX = /^[0-9a-f]{32}$/;

/** FNV-1a, four times with other starting values: 128 bits for an id that is not a uuid. */
function hash128(text: string): string {
  let out = "";
  for (const seed of [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b]) {
    let h = seed >>> 0;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

/** An id's 128 bits as 32 hex digits: a uuid's own, else a hash of it. */
export function idBits(id: string): string {
  const hex = id.replace(/-/g, "").toLowerCase();
  return HEX.test(hex) ? hex : hash128(id);
}

function xorHex(a: string, b: string): string {
  let out = "";
  for (let i = 0; i < 32; i++) out += (parseInt(a[i], 16) ^ parseInt(b[i], 16)).toString(16);
  return out;
}

const asUuid = (hex: string) => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

/** The mask between two ids: XOR it with one to get the other. */
export const maskBetween = (a: string, b: string): string => xorHex(idBits(a), idBits(b));

/** An id with a mask applied. */
export const maskId = (id: string, mask: string): string => asUuid(xorHex(idBits(id), mask));

/** A new random mask (128 bits). */
export function randomMask(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
