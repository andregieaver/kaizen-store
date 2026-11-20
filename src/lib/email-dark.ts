/**
 * An email as a mail app that turns it dark shows it (email plan M3.4): Gmail's and Outlook's apps reverse a light email's colours
 * whatever it declares, keeping pictures as they are. The flow's preview draws it so, to see whether the words still read; never sent.
 */
const DARK = "<style data-dark-preview>html{filter:invert(1) hue-rotate(180deg);background:#fff}img,picture,video{filter:invert(1) hue-rotate(180deg)}</style>";

export function darkPreview(html: string): string {
  return html.includes("</head>") ? html.replace("</head>", `${DARK}</head>`) : DARK + html;
}
