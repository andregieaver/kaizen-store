/**
 * A picture's width and height from its first bytes (D88), for the media
 * library: PNG, JPEG, WebP, AVIF and GIF, the types the admin uploads. Anything
 * else, or a damaged file, gives null (the library measures it when shown).
 */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, length: number) => String.fromCharCode(...bytes.subarray(at, at + length));
  const sized = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);

  // PNG: the IHDR chunk follows the 8-byte signature.
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === "PNG" && ascii(12, 4) === "IHDR") {
    return sized(view.getUint32(16), view.getUint32(20));
  }
  // GIF: the logical screen's size, little-endian.
  if (bytes.length >= 10 && ascii(0, 3) === "GIF") {
    return sized(view.getUint16(6, true), view.getUint16(8, true));
  }
  // WebP: lossy (VP8), lossless (VP8L) or extended (VP8X).
  if (bytes.length >= 16 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const chunk = ascii(12, 4);
    if (chunk === "VP8L" ? bytes.length < 25 : bytes.length < 30) return null;
    if (chunk === "VP8 ") return sized(view.getUint16(26, true) & 0x3fff, view.getUint16(28, true) & 0x3fff);
    if (chunk === "VP8L") {
      const b = view.getUint32(21, true);
      return sized((b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1);
    }
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return sized(width, height);
    }
    return null;
  }
  // AVIF (and HEIF): an ISO media file whose `ispe` property gives the picture's size.
  if (bytes.length >= 16 && ascii(4, 4) === "ftyp" && /^(avif|avis|heic|heix|mif1)/.test(ascii(8, 4))) {
    for (let at = 12; at + 16 <= bytes.length; at++) {
      if (bytes[at] === 0x69 && ascii(at, 4) === "ispe") return sized(view.getUint32(at + 8), view.getUint32(at + 12));
    }
    return null;
  }
  // JPEG: walk the segments to the first start-of-frame marker.
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) return null;
      const marker = bytes[at + 1];
      // Fill bytes before a marker.
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const length = view.getUint16(at + 2);
      const frame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (frame) return sized(view.getUint16(at + 7), view.getUint16(at + 5));
      at += 2 + length;
    }
  }
  return null;
}

/** A file's size for people: 512 B, 12.3 kB, 4.5 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(bytes < 10_000 ? 1 : 0)} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** A file's type for people, from its media type: WebP picture, MP4 video. */
export function describeType(contentType: string): string {
  const [kind, sub = ""] = contentType.split("/");
  const name = { jpeg: "JPEG", png: "PNG", webp: "WebP", avif: "AVIF", gif: "GIF", "svg+xml": "SVG", mp4: "MP4", webm: "WebM" }[sub] ?? sub.toUpperCase();
  if (kind === "image") return `${name} picture`;
  if (kind === "video") return `${name} video`;
  return contentType;
}
