/**
 * The HTML component's frame (D91): the owner's HTML runs in a sandboxed
 * frame of its own, a separate origin from the site (no `allow-same-origin`),
 * so its scripts can read nothing of the site's or the admin's: no cookies,
 * storage or session. The frame's document is built here: the HTML, a base
 * that takes the page's font and colour when the page sends them, and a
 * script that tells the page the content's height, so the frame fits it.
 */

/** What a frame's scripts may do: run, open links in new tabs or the whole window when clicked, and send forms. */
export const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation";

/** The tallest a frame grows to fit its content. */
export const FRAME_HEIGHT_MAX = 10_000;

/** The message a frame sends with its content's height. */
export const HEIGHT_MESSAGE = "kaizen:html-height";
/** The message the page sends with its font and colour. */
export const LOOK_MESSAGE = "kaizen:html-look";

export type FrameLook = { fontFamily: string; fontSize: string; lineHeight: string; color: string };

/** A value taken from the page's styles, kept to what CSS values hold. */
export function cssValue(value: string): string {
  return value.replace(/[<>{};\\]/g, "").slice(0, 300);
}

/** The frame's height for a height it reports: whole pixels, at most `FRAME_HEIGHT_MAX`; null for anything else. */
export function frameHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.ceil(value), FRAME_HEIGHT_MAX);
}

/** The frame's document for the owner's HTML. */
export function frameDocument(html: string): string {
  // Reports its height as it changes (pictures loading, text wrapping) and takes the page's look when sent.
  const script = `(() => {
  const root = document.documentElement;
  let last = -1;
  const report = () => {
    const height = Math.ceil(root.getBoundingClientRect().height);
    if (height !== last) { last = height; parent.postMessage({ type: ${JSON.stringify(HEIGHT_MESSAGE)}, height }, "*"); }
  };
  new ResizeObserver(report).observe(root);
  addEventListener("load", report);
  addEventListener("message", (event) => {
    if (event.source !== parent || !event.data || event.data.type !== ${JSON.stringify(LOOK_MESSAGE)}) return;
    const look = event.data.look || {};
    for (const [name, property] of [["fontFamily", "--kaizen-font"], ["fontSize", "--kaizen-size"], ["lineHeight", "--kaizen-leading"], ["color", "--kaizen-color"]]) {
      if (typeof look[name] === "string") root.style.setProperty(property, look[name]);
    }
    last = -1;
    report();
  });
  report();
})();`;
  return [
    "<!doctype html>",
    '<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    "<style>html{font-family:var(--kaizen-font,system-ui,sans-serif);font-size:var(--kaizen-size,16px);line-height:var(--kaizen-leading,1.5);color:var(--kaizen-color,inherit)}body{margin:0}img,video,iframe,svg{max-width:100%}</style>",
    "</head><body>",
    html,
    `<script>${script}</script>`,
    "</body></html>",
  ].join("");
}
