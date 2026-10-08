import { scopedCss, siteCss } from "@/lib/custom-css";

/** A short name for a stylesheet's text, so changed CSS is a new stylesheet to React. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * An owner's own CSS (D100) in the page's head, after the site's theme, so
 * it wins where both set something. Nothing when there is none, or when it
 * could not be used (it is checked when saved, and again here).
 */
export function CustomCss({ css, name }: { css: string | null | undefined; name: string }) {
  const text = siteCss(css);
  if (!text) return null;
  return (
    <style href={`css-${name}-${hash(text)}`} precedence="custom">
      {text}
    </style>
  );
}

/**
 * CSS kept inside `root` and what it holds, each part checked on its own: in
 * the admin (the builder's canvas, previews), where it must never reach the
 * admin's own page. In the builder's canvas (`container`, D179) its width
 * queries follow the canvas's size instead of the window.
 */
export function ScopedCss({ css, root, container }: { css: (string | null | undefined)[]; root: string; container?: string }) {
  const text = css.map((part) => (part ? scopedCss(part, root, container) : "")).filter(Boolean).join("\n");
  return text ? <style>{text}</style> : null;
}
