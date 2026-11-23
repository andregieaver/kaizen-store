/**
 * Kaizen's emails (D26): plain, readable HTML that works in every mail app
 * (tables, inline styles, no images), with a text version alongside. Pure
 * functions, so they can be tested without sending anything.
 */

import { DEFAULT_EMAIL_LOOK, type EmailLook } from "./email-look";

export type EmailBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "button"; text: string; url: string }
  /** A quiet link on a line of its own (D392: a back-in-stock request's *Cancel*), where a button would compete with the main one. */
  | { type: "link"; text: string; url: string }
  | { type: "lines"; rows: EmailLine[] }
  | { type: "code"; text: string }
  /** A picture at the email's width (a full address), optionally a link (D297's broadcasts). */
  | { type: "image"; url: string; alt: string; href?: string | null }
  /**
   * A product as the store shows it (D352): its picture, title and price written by code from the catalogue's read for the recipient's
   * market, and a link to its page; `small` lines under the price (the VAT label, a reduction's 30-day price, the unit price).
   */
  | { type: "product"; title: string; image: string | null; alt: string; price: string; small: string[]; url: string; linkText: string }
  /** A running campaign's offer in the shop's own words (D352: `noticeText()`), with when it ends. */
  | { type: "offer"; title: string; text: string; until: string | null }
  | { type: "divider" }
  /** A quiet row of links, such as the store's social profiles (M4.1): each its name, joined by dots. */
  | { type: "links"; items: { text: string; url: string }[] }
  /** The owner's own HTML (M4.1), already cleaned by the server (`cleanEmailHtml()`): drawn as it is, with its text version. Only `buildBroadcastEmail()` makes one. */
  | { type: "html"; html: string; text: string }
  /** Two or three cells side by side (M4.1), each its picture, heading, words and button; on a narrow screen they stack. */
  | { type: "columns"; cells: EmailCell[] }
  /**
   * The AI assistant's signature under its answer by email (D332): the closing, its picture, name and occupation, and the site's logo as a
   * link to the site. Pictures are full addresses; either may be missing.
   */
  | {
      type: "signature";
      greeting: string;
      name: string;
      occupation: string;
      avatar: string | null;
      logo: { url: string; width: number; height: number; alt: string; href: string } | null;
    };

/** A cell of a columns block: any of a picture, a heading, words and a button; the picture links where the button does. */
export type EmailCell = {
  image: { url: string; alt: string } | null;
  heading: string;
  text: string;
  button: { text: string; url: string } | null;
};

/** The width of the email's content, in pixels: the card's 560 less its padding. */
const CONTENT_WIDTH = 512;

/**
 * Cells side by side as inline blocks of a fixed most width, so mail apps that read no media queries still stack them on a phone (the
 * "fluid hybrid" way); each cell's own table keeps its padding.
 */
function cellsHtml(cells: EmailCell[], look: EmailLook): string {
  const width = Math.floor(CONTENT_WIDTH / cells.length);
  const cell = (c: EmailCell) => {
    const picture = c.image
      ? `<img src="${escapeHtml(c.image.url)}" alt="${escapeHtml(c.image.alt)}" width="${width - 16}" style="display:block;width:100%;height:auto;border:0;border-radius:8px;margin:0 0 12px">`
      : "";
    const parts = [
      c.image && c.button ? `<a href="${escapeHtml(c.button.url)}">${picture}</a>` : picture,
      c.heading ? `<h2 style="margin:0 0 8px;font-size:18px;line-height:1.3;color:#171717">${escapeHtml(c.heading)}</h2>` : "",
      c.text ? `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#171717">${escapeHtml(c.text).replace(/\n/g, "<br>")}</p>` : "",
      c.button
        ? `<p style="margin:0"><a href="${escapeHtml(c.button.url)}" style="display:inline-block;background:${look.accent};color:${look.onAccent};text-decoration:none;font-weight:600;font-size:15px;padding:10px 18px;border-radius:${look.radius}">${escapeHtml(c.button.text)}</a></p>`
        : "",
    ].join("");
    return `<div class="kf-cell" style="display:inline-block;width:100%;max-width:${width}px;vertical-align:top;text-align:left"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr><td style="padding:0 16px 16px 0;font-family:${FONT}">${parts}</td></tr></table></div>`;
  };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px;border-collapse:collapse"><tr><td style="font-size:0;text-align:left;padding:0">${cells.map(cell).join("")}</td></tr></table>`;
}

/** A row of a list of lines: a product with its picture (a full address), or a total. */
export type EmailLine = {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
  image?: string | null;
  /** A full address the value links to (D348: a briefing's item opens the page that acts on it). */
  url?: string | null;
};

export type EmailContent = {
  subject: string;
  /** Shown by mail apps beside the subject. */
  preview: string;
  blocks: EmailBlock[];
  /** The store's name and legal details, at the foot. */
  footer: string[];
  lang: string;
  /** A way to stop emails like this one, at the very foot (D33). */
  unsubscribe?: { text: string; linkText: string; url: string };
  /** The store's own look for a marketing email's buttons (M4.1, `emailLook()`); none, the default black. */
  look?: EmailLook;
};

export type RenderedEmail = { subject: string; html: string; text: string };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function blockHtml(block: EmailBlock, look: EmailLook = DEFAULT_EMAIL_LOOK): string {
  switch (block.type) {
    case "heading":
      return `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#171717">${escapeHtml(block.text)}</h1>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#171717">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
    case "button":
      return `<p style="margin:8px 0 24px"><a href="${escapeHtml(block.url)}" style="display:inline-block;background:${look.accent};color:${look.onAccent};text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:${look.radius}">${escapeHtml(block.text)}</a></p>`;
    case "link":
      return `<p style="margin:0 0 16px;font-size:14px;line-height:1.5"><a href="${escapeHtml(block.url)}" style="color:#525252;text-decoration:underline">${escapeHtml(block.text)}</a></p>`;
    case "code":
      return `<p style="margin:0 0 16px;font-size:32px;letter-spacing:6px;font-weight:700;font-family:ui-monospace,Menlo,monospace;color:#171717">${escapeHtml(block.text)}</p>`;
    case "divider":
      return `<hr style="border:none;border-top:1px solid #e5e5e5;margin:8px 0 16px">`;
    case "links":
      return `<p style="margin:8px 0 16px;font-size:14px;line-height:1.6;color:#525252">${block.items
        .map((item) => `<a href="${escapeHtml(item.url)}" style="color:#171717;text-decoration:underline">${escapeHtml(item.text)}</a>`)
        .join(" &middot; ")}</p>`;
    case "columns":
      return cellsHtml(block.cells, look);
    case "html":
      return `<div style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#171717">${block.html}</div>`;
    case "image": {
      const picture = `<img src="${escapeHtml(block.url)}" alt="${escapeHtml(block.alt)}" width="512" style="display:block;width:100%;max-width:512px;height:auto;border:0;border-radius:8px">`;
      return `<p style="margin:0 0 16px">${block.href ? `<a href="${escapeHtml(block.href)}">${picture}</a>` : picture}</p>`;
    }
    case "product": {
      const picture = block.image
        ? `<td width="120" style="width:120px;padding:0 16px 0 0;vertical-align:top"><a href="${escapeHtml(block.url)}"><img src="${escapeHtml(block.image)}" alt="${escapeHtml(block.alt)}" width="120" height="120" style="display:block;width:120px;height:120px;border:0;border-radius:8px;object-fit:cover;background:#f5f5f4"></a></td>`
        : "";
      const small = block.small.map((line) => `<br><span style="font-size:13px;color:#525252">${escapeHtml(line)}</span>`).join("");
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse"><tr>${picture}<td style="vertical-align:top;font-size:16px;line-height:1.4;color:#171717"><a href="${escapeHtml(block.url)}" style="color:#171717;font-weight:600;text-decoration:none">${escapeHtml(block.title)}</a><br><span style="font-size:16px">${escapeHtml(block.price)}</span>${small}<br><a href="${escapeHtml(block.url)}" style="display:inline-block;margin-top:8px;font-size:14px;color:#171717">${escapeHtml(block.linkText)}</a></td></tr></table>`;
    }
    case "offer":
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse"><tr><td style="padding:12px 16px;background:#f5f5f4;border-radius:8px;font-size:16px;line-height:1.4;color:#171717"><strong>${escapeHtml(block.text)}</strong><br><span style="font-size:14px;color:#525252">${escapeHtml(block.title)}${block.until ? ` · ${escapeHtml(block.until)}` : ""}</span></td></tr></table>`;
    case "signature": {
      const picture = block.avatar
        ? `<td width="56" style="width:56px;padding:0 12px 0 0;vertical-align:middle"><img src="${escapeHtml(block.avatar)}" alt="${escapeHtml(block.name)}" width="56" height="56" style="display:block;width:56px;height:56px;border:0;border-radius:50%;object-fit:cover;background:#f5f5f4"></td>`
        : "";
      const who = `<td style="vertical-align:middle;font-size:15px;line-height:1.4;color:#171717"><strong>${escapeHtml(block.name)}</strong>${block.occupation ? `<br><span style="font-size:14px;color:#525252">${escapeHtml(block.occupation)}</span>` : ""}</td>`;
      // The logo 32 pixels high, as wide as its shape asks, at most 200.
      const logo = block.logo
        ? (() => {
            const { url, width, height, alt, href } = block.logo;
            const wide = Math.min(200, Math.max(1, Math.round((32 * width) / Math.max(1, height))));
            return `<tr><td colspan="2" style="padding:16px 0 0"><a href="${escapeHtml(href)}"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" width="${wide}" height="32" style="display:block;width:${wide}px;height:32px;border:0"></a></td></tr>`;
          })()
        : "";
      return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border-collapse:collapse"><tr><td colspan="2" style="padding:0 0 12px;font-size:16px;line-height:1.5;color:#171717">${escapeHtml(block.greeting)}</td></tr><tr>${picture}${who}</tr>${logo}</table>`;
    }
    case "lines": {
      // With pictures, a column for them; rows without one (totals) leave it empty, so the titles line up.
      const pictures = block.rows.some((row) => row.image);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">${block.rows
        .map(
          (row) =>
            `<tr>${pictures ? `<td width="56" style="width:56px;padding:6px 12px 6px 0;vertical-align:middle">${row.image ? `<img src="${escapeHtml(row.image)}" alt="" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:8px;object-fit:cover;background:#f5f5f4">` : ""}</td>` : ""}<td style="padding:6px 0;font-size:15px;vertical-align:middle;color:${row.muted ? "#525252" : "#171717"};${row.strong ? "font-weight:700;" : ""}">${escapeHtml(row.label)}</td><td align="right" style="padding:6px 0 6px 12px;font-size:15px;white-space:nowrap;vertical-align:middle;color:${row.muted ? "#525252" : "#171717"};${row.strong ? "font-weight:700;" : ""}">${row.url ? `<a href="${escapeHtml(row.url)}" style="color:#171717">${escapeHtml(row.value)}</a>` : escapeHtml(row.value)}</td></tr>`,
        )
        .join("")}</table>`;
    }
  }
}

function blockText(block: EmailBlock): string {
  switch (block.type) {
    case "heading":
      return `${block.text}\n${"=".repeat(Math.min(block.text.length, 60))}`;
    case "paragraph":
      return block.text;
    case "button":
    case "link":
      return `${block.text}: ${block.url}`;
    case "code":
      return block.text;
    case "divider":
      return "----";
    case "links":
      return block.items.map((item) => `${item.text}: ${item.url}`).join("\n");
    case "html":
      return block.text;
    case "columns":
      return block.cells
        .map((c) => [c.image?.alt && `[${c.image.alt}]`, c.heading, c.text, c.button && `${c.button.text}: ${c.button.url}`].filter(Boolean).join("\n"))
        .join("\n\n");
    case "image":
      return [block.alt && `[${block.alt}]`, block.href].filter(Boolean).join(" ");
    case "lines":
      return block.rows.map((row) => `${row.label}: ${row.value}${row.url ? ` (${row.url})` : ""}`).join("\n");
    case "product":
      return [block.title, block.price, ...block.small, block.url].join("\n");
    case "offer":
      return [block.text, block.title, block.until].filter(Boolean).join("\n");
    case "signature":
      return [block.greeting, "", block.name, ...(block.occupation ? [block.occupation] : []), ...(block.logo ? [`${block.logo.alt}: ${block.logo.href}`] : [])].join("\n");
  }
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const html = `<!doctype html>
<html lang="${escapeHtml(content.lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><style>@media (max-width:540px){.kf-cell{max-width:100%!important}}</style><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:${FONT}">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(content.preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px"><tr><td style="padding:28px 24px">
${content.blocks.map((block) => blockHtml(block, content.look)).join("\n")}
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px"><tr><td style="padding:16px 24px;font-size:13px;line-height:1.5;color:#525252">
${content.footer.map(escapeHtml).join("<br>")}${
    content.unsubscribe
      ? `<br><br>${escapeHtml(content.unsubscribe.text)} <a href="${escapeHtml(content.unsubscribe.url)}" style="color:#525252">${escapeHtml(content.unsubscribe.linkText)}</a>`
      : ""
  }
</td></tr></table>
</td></tr></table>
</body>
</html>`;
  const stop = content.unsubscribe
    ? [`${content.unsubscribe.text} ${content.unsubscribe.linkText}: ${content.unsubscribe.url}`]
    : [];
  const text = [...content.blocks.map(blockText), "", ...content.footer, ...stop].join("\n\n").replace(/\n{3,}/g, "\n\n");
  return { subject: content.subject, html, text };
}
