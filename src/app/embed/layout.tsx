import "../globals.css";

/**
 * The chat's frame on a site of the owner's own (D581, `docs/support-embed.md`): its own root, see-through, with nothing of a site's
 * chrome, so the chat's button and panel are all that show on the page holding it. `color-scheme: normal` matches the frame's element
 * (`public/embed/chat.js`), so browsers paint no backdrop behind it; the colours still follow the visitor's light or dark setting.
 */
export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ colorScheme: "normal", background: "transparent" }}>
      <body className="antialiased" style={{ background: "transparent" }}>
        {children}
      </body>
    </html>
  );
}
