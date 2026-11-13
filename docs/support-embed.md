# Chat widgets on the owner's own websites (decision D581)

Kaizena Flow's support chat (D81, D216) has only been shown on Kaizena Flow's own pages: a store's storefront and Kaizena Flow's site.
This lets an owner put the same chat on other websites they run (a company site, a blog, a WordPress site) with one tag in each site's
footer. An account makes as many **chat widgets** as it needs, in each of its stores; each widget has **its own look** to match its site
and goes on **one or several websites**. Conversations land in the store's inbox, with the same AI first line, hand-over to a person,
queue, email follow-up and settings.

Asked for by the owner on 13 November 2026 (first one site per store, then the same day: several widgets per account, each on several
sites, with their own styling to match any site design). Built in steps. Step 1 is built; steps 2 to 4 are planned here.

## 1. How it works

```
 The owner's site (https://www.example.com)                 Kaizena Flow (https://kaizenaflow.com)
 ┌───────────────────────────────────────────┐
 │ <script src=".../embed/chat.js"           │  1. loads   ┌──────────────────────────────┐
 │         data-key="{widget key}" async>    │ ──────────▶ │ public/embed/chat.js         │
 │                                           │             └──────────────────────────────┘
 │  ┌─────────────── iframe ──────────────┐  │  2. frames  ┌──────────────────────────────┐
 │  │ /embed/chat/{key}/www.example.com   │◀─┼──────────── │ /embed/chat/[key]/[host]     │
 │  │                                     │  │             │  frame-ancestors             │
 │  │   ChatWidget, in the store's theme  │  │             │   https://www.example.com    │
 │  │   with the widget's own look over   │  │             │  draws only on a found site  │
 │  │   it (colours, corners, font, …)    │  │             │  of that widget              │
 │  └──────────────────┬──────────────────┘  │             └──────────────────────────────┘
 │     3. postMessage: │ open? side, room    4. same-origin ┌──────────────────────────────┐
 │        the loader   │ sizes the frame   ───────────────▶ │ /api/chat*  (sameSite() ok)  │
 └─────────────────────┼───────────────────────────────────│  {embed: key, host, …}       │
                       │                                   │  → chatPlace() → the desk     │
                       │                                   │  → the inbox, the AI, people  │
                       └───────────────────────────────────┴──────────────────────────────┘
```

1. **The tag** loads `public/embed/chat.js` from Kaizena Flow's own origin. It reads the widget's key, does nothing on a page that is not
   `https`, and puts one frame in the corner: see-through and letting clicks through until the chat tells its state. It is never
   `display: none`, because browsers run no scripts in a hidden frame (found in testing: the chat never started).
2. **The frame** is `/embed/chat/{key}/{host}?p={path}`, sent with `Content-Security-Policy: frame-ancestors https://{host}`
   (`embedFrameHeaders()` in `next.config.ts`, using the address's own `:host`). The page draws the chat only when the key is a widget's,
   the host is one of that widget's sites (or its `www.` twin, `mayFrame()`), and the widget's tag was found there. A site that copies the
   tag, or another widget's site, gets a frame its browser refuses to show, or an empty one.
3. **The chat inside is the same `ChatWidget`**, in the store's theme with the widget's own look over it (`widgetCss()` on the element
   around the chat), in the language of the market chosen for the widget, followed by the owner's own CSS for it. It tells the page holding
   it whether it is open, its side, the room its closed button needs (measured, so any words and offsets fit) and the open panel's width
   (`FrameMessage`); the loader sizes and places the frame from that, and listens only to its own frame and origin.
4. **Its requests go to Kaizena Flow's own origin**, so the chat's routes keep refusing every other site (`sameSite()`, unchanged). Each
   request carries the widget's key and the page's host; `chatPlace()` turns them into the desk (`embedPlace()`), with `site.embed` set.

Why a frame and not a script that draws the chat on the owner's page: the chat's routes need not be opened to other origins (no CORS, no
weaker `sameSite()`), the site's CSS cannot break the chat nor the chat's the site, and no React or Kaizena Flow code runs on the owner's
page beyond 50 lines of loader. The widget's look is drawn inside the frame, so it can match any site without touching it.

## 2. Decisions

- **Widgets, then sites.** A desk (a store's, or Kaizena Flow's) has up to 20 widgets (`WIDGETS_MAX`), each named once per desk. A widget
  has one public key and so one tag, the same on each of its sites, up to 20 sites (`SITES_MAX`). A site is one host, typed as the owner
  pleases (`normalizeHost()`); its `www.` twin is the same site. A site is on at most one of the desk's widgets: two chats on one page
  would answer each other's visitors. An account with several stores makes widgets in each, and each answers into that store's desk.
- **Each widget has its own look** (`src/lib/support-widget-style.ts`, kept as `support_widgets.style`, read back by `readStyle()`, which
  falls back to the default for anything it cannot read). Left alone it is the store's own chat. Homer picks a **button colour**, the
  **corners** (the store's, square, soft, round), the **side** (bottom right or left) and the **button** (icon only, or icon and words, with
  the words). Under *More choices*, Lisa has the **background** and **text** colours (the softer shades are mixed from the two with
  `color-mix`, and the text on the button is black or white, whichever reads), the **panel width** (narrow, standard, wide), the button's
  **offsets** to the pixel, a **font** from the catalogue (installed when saved, D59), the **greeting**, the **language**, the **privacy page**
  and **CSS of her own**, which runs only inside the chat's frame (`[data-chat-launcher]` is the button, `[data-chat-panel]` the open chat)
  and is checked as owners' CSS always is (`cssProblem()`). The admin shows a **live preview** beside the choices, drawn from the same
  `widgetCss()`. The greeting and the button's words are shown to visitors only and never reach the AI's prompt.
- **The tag must be found before the chat shows** on a site (the owner asked that it be restricted to the site holding the tag). The site's
  front page is fetched through `safeFetch()` (no private addresses, a redirect within the site followed, never to another site) and
  searched for the loader's script with the widget's key (`tagFoundIn()`). A tag added by a tag manager is not in the HTML, so a TXT record
  `kaizena-flow-chat={key}` on the host proves the site instead (`dnsFound()`). The check runs when the site is added, on *Check now*, and
  when the frame is opened on a site not yet found (at most every 10 minutes, the time claimed first so many visitors ask once). Once found,
  a site stays found until the owner removes it: a cookie wall or an outage must not switch a working chat off.
- **The key is public** (anyone can read it in a site's HTML) and proves nothing alone: the frame's `frame-ancestors` and the found tag do.
  A host can be on widgets of several desks (a squatter cannot block the real owner), but only a widget whose tag is on the site shows.
- **Step 1 answers from the knowledge base alone.** On a widget the AI has one tool, `search_content` over the desk's knowledge base
  documents (`searchKnowledge(…, {documentsOnly: true})`, `embedTools()`, `embedTool()`), and the prompt says so (`systemPrompt({embed})`):
  no products, prices, store pages, `navigate` or order tools. The store's pages are another site's, and answering about the owner's
  website from them would be wrong. Step 2 adds each site's own pages.
- **Nobody signs in there.** A store's customer cookie in a third-party frame is blocked by Safari and Chrome, and an external site's
  visitors are not the store's customers. So `sessionCustomer()` is null on a widget, the sign-in, sign-in code and confirm routes refuse,
  and support's order tools are not offered (`runSupportTurn()`). The email card works as everywhere.
- **The staff see where it started**: `page_path` holds the site's host with the page's path (`www.example.com/pricing`), shown as
  *Started on*. A column for the widget (`support_conversations.widget_id`) and per-widget figures come in step 3.
- **A private store (D339) still answers there**: the owner put the chat on their own site, and it reads only the knowledge base. A store
  that is not open is a 404, as its own chat is.
- **Kaizena Flow too** (the parity rule): `/admin/platform/support/widgets` is the same screen for Kaizena Flow's desk (`store_id` null),
  in Kaizena Flow's own colours.
- **Never copied** with a store (`store-copy-rules.ts`): a copy is another business, whose websites must carry their own tags. The store's
  data export holds its widgets (their sites hang off them).
- **Nothing new reaches the prompt as free text**: the host is checked to be a host name, and the page's path was already sent.

## 3. What step 1 built

| Part | Where |
|---|---|
| Tables `commerce.support_widgets` (name, public key, market, privacy page, style) and `commerce.support_widget_sites` (host, found by page or DNS, last check) | `src/db/schema.ts`, `20261113074745_support_widgets`, `20261113074754_support_widgets_rules` |
| The pure rules: hosts, keys, the tag, finding it, framing | `src/lib/support-embed.ts` |
| A widget's look: the choices, their checks and their CSS | `src/lib/support-widget-style.ts` |
| Widgets and sites: making, saving, checking, removing; the frame's lookup | `src/server/support-widgets.ts`, the actions' shared part `src/server/support-widget-actions.ts` |
| The loader | `public/embed/chat.js` |
| The frame's root and page | `src/app/embed/layout.tsx`, `src/app/embed/chat/[key]/[host]/page.tsx`, `FrameChat` in `src/components/site-chat.tsx` |
| The widget in a frame | `ChatWidget`'s `embedded` prop: the host page's path, the side, offsets, button and panel width, the state told to the page, no page opened |
| The routes | `chatPlace()` → `embedPlace()` in `src/server/chat-route.ts` |
| The AI | `embedTools()`, `systemPrompt({embed})` in `src/lib/chat.ts`; `embedTool()` in `src/server/chat-agent.ts` |
| The admin | Support → *Website chat*, a store's (`/admin/{store}/support/widgets`, one widget at `/{id}`) and Kaizena Flow's; `src/components/admin/support/widgets/` (`WidgetsList`, `WidgetEditor`, `WidgetPreview`, `WidgetSites`) |
| Tests | `src/lib/support-embed.test.ts`, `src/lib/support-widget-style.test.ts`, `src/db/support.test.ts` 11, `src/server/support-widgets.int.test.ts`, `e2e/signed-in/support-embed.spec.ts` |

## 4. The steps after

**Step 2 — the sites' own pages.** A crawler for found sites only: `robots.txt` and the sitemap read as `old-shop.ts` reads them, then
pages on the site's host alone through `safeFetch()` (a redirect off the host dropped), text by `web-page-text.ts`, cut into
`knowledge_chunks` with a new source (the widget's site and the page's address) and embedded by the five-minute cron as pages are. Re-read
weekly and on *Read the site again*, within a page cap per site (`PAGES_PER_DAY` today is 200). A widget then answers from its own sites'
pages as well as the knowledge base, with the page's full address as a link chip that opens in the site's own tab. The sites' pages are
outside text reaching a prompt, so this step adds an agent-eval case with instructions hidden in a page, and a new recording.

**Step 3 — more per widget.** The language from the page's own `<html lang>` when the store has it; the page's path sent again when a
single-page site moves (`history` events in the loader); `support_conversations.widget_id` and the widget in the inbox's filters and the
reports; colours read from a site's front page as a suggestion (`theme-color`, its buttons); a store feature and plan limits for widgets
and sites (D178, D314).

**Step 4 — WordPress.** The plugin (D169) gets *Show the chat on this site*: it picks or makes a widget through its connection and puts the
tag in the footer itself, so a WordPress owner never copies anything.

## 5. Needs human review

- The owner of the website is the controller of their visitors' conversations and Kaizena Flow its processor, as for a store's own chat;
  the data processing terms should say that the chat may run on the owner's other websites too.
- The chat's notice links the widget's privacy page when one is given; without one it links none, and each site's own privacy notice should
  mention the chat.
