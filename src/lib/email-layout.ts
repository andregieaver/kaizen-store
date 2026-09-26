/**
 * Kaizen's emails (D26): plain, readable HTML that works in every mail app
 * (tables, inline styles, no images), with a text version alongside. Pure
 * functions, so they can be tested without sending anything.
 */

export type EmailBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "button"; text: string; url: string }
  | { type: "lines"; rows: EmailLine[] }
  | { type: "code"; text: string }
  | { type: "divider" };

/** A row of a list of lines: a product with its picture (a full address), or a total. */
export type EmailLine = { label: string; value: string; strong?: boolean; muted?: boolean; image?: string | null };

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

function blockHtml(block: EmailBlock): string {
  switch (block.type) {
    case "heading":
      return `<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#171717">${escapeHtml(block.text)}</h1>`;
    case "paragraph":
      return `<p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#171717">${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`;
    case "button":
      return `<p style="margin:8px 0 24px"><a href="${escapeHtml(block.url)}" style="display:inline-block;background:#171717;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;padding:12px 22px;border-radius:999px">${escapeHtml(block.text)}</a></p>`;
    case "code":
      return `<p style="margin:0 0 16px;font-size:32px;letter-spacing:6px;font-weight:700;font-family:ui-monospace,Menlo,monospace;color:#171717">${escapeHtml(block.text)}</p>`;
    case "divider":
      return `<hr style="border:none;border-top:1px solid #e5e5e5;margin:8px 0 16px">`;
    case "lines": {
      // With pictures, a column for them; rows without one (totals) leave it empty, so the titles line up.
      const pictures = block.rows.some((row) => row.image);
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">${block.rows
        .map(
          (row) =>
            `<tr>${pictures ? `<td width="56" style="width:56px;padding:6px 12px 6px 0;vertical-align:middle">${row.image ? `<img src="${escapeHtml(row.image)}" alt="" width="56" height="56" style="display:block;width:56px;height:56px;border-radius:8px;object-fit:cover;background:#f5f5f4">` : ""}</td>` : ""}<td style="padding:6px 0;font-size:15px;vertical-align:middle;color:${row.muted ? "#525252" : "#171717"};${row.strong ? "font-weight:700;" : ""}">${escapeHtml(row.label)}</td><td align="right" style="padding:6px 0 6px 12px;font-size:15px;white-space:nowrap;vertical-align:middle;color:${row.muted ? "#525252" : "#171717"};${row.strong ? "font-weight:700;" : ""}">${escapeHtml(row.value)}</td></tr>`,
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
      return `${block.text}: ${block.url}`;
    case "code":
      return block.text;
    case "divider":
      return "----";
    case "lines":
      return block.rows.map((row) => `${row.label}: ${row.value}`).join("\n");
  }
}

export function renderEmail(content: EmailContent): RenderedEmail {
  const html = `<!doctype html>
<html lang="${escapeHtml(content.lang)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(content.subject)}</title></head>
<body style="margin:0;padding:0;background:#f5f5f4;font-family:${FONT}">
<span style="display:none;max-height:0;overflow:hidden">${escapeHtml(content.preview)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f4"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px"><tr><td style="padding:28px 24px">
${content.blocks.map(blockHtml).join("\n")}
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
