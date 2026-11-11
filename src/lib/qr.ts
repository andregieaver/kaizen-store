/** QR codes as SVG (D554: a product passport's data carrier). Pure; kept apart so pages that only link a passport do not load the encoder. */

import qrcode from "qrcode-generator";

/**
 * A QR code of an address as an SVG, black on white with the quiet zone the standard asks for, error correction M (a label that is scuffed
 * still reads). Drawn as one path, so it scales for print.
 */
export function qrSvg(address: string, size = 256): string {
  const code = qrcode(0, "M");
  code.addData(address);
  code.make();
  const count = code.getModuleCount();
  const quiet = 4;
  const total = count + quiet * 2;
  let path = "";
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) if (code.isDark(row, col)) path += `M${col + quiet} ${row + quiet}h1v1h-1z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
