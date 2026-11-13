# The chat on an owner's own website (decision D581)

Kaizena Flow's support chat (D81, D216) has only been shown on Kaizena Flow's own pages: a store's storefront and Kaizena Flow's site.
This lets an owner put the same chat on another website they run (a company site, a blog, a WordPress site) with one tag in its footer.
Conversations land in the same inbox, with the same AI first line, hand-over to a person, queue, email follow-up and settings.

Asked for by the owner on 13 November 2026. Built in steps. Step 1 is built (this change); steps 2 to 4 are planned here.

## 1. How it works

```
 The owner's site (https://www.example.com)                 Kaizena Flow (https://kaizenaflow.com)
 ┌───────────────────────────────────────────┐
 │ <script src=".../embed/chat.js"           │  1. loads   ┌──────────────────────────────┐
 │         data-key="k3…" async>             │ ──────────▶ │ public/embed/chat.js         │
 │                                           │             └──────────────────────────────┘
 │  ┌─────────────── iframe ──────────────┐  │  2. frames  ┌──────────────────────────────┐
 │  │ /embed/chat/k3…/www.example.com?p=/ │◀─┼──────────── │ /embed/chat/[key]/[host]     │
 │  │                                     │  │             │  frame-ancestors             │
 │  │   ChatWidget (the same component    │  │             │   https://www.example.com    │
 │  │   as on a store's pages)            │  │             │  draws only for a found site │
 │  └──────────────────┬──────────────────┘  │             └──────────────────────────────┘
 │     3. postMessage: │ ready / open / closed              ┌──────────────────────────────┐
 │        the loader   │ resizes the frame   4. same-origin │ /api/chat*  (sameSite() ok)  │
 └─────────────────────┼─────────────────────────────────▶ │  {embed: key, host, …}       │
                       │                                   │  → chatPlace() → the desk     │
                       │                                   │  → the inbox, the AI, people  │
                       └───────────────────────────────────┴──────────────────────────────┘
```

1. **The tag** loads `public/embed/chat.js` from Kaizena Flow's own origin. It reads its key, does nothing on a page that is not
   `https`, and puts one hidden frame in the corner.
2. **The frame** is `/embed/chat/{key}/{host}?p={path}`, served by Kaizena Flow with `Content-Security-Policy: frame-ancestors
   https://{host}` (`embedFrameHeaders()` in `next.config.ts`, using the address's own `:host`). The page draws the chat only when the key
   is a site's, the host is that site's (or its `www.` twin, `mayFrame()`), and the site's tag was found. Another site that copies the tag
   gets a frame its browser refuses to show, or an empty one.
3. **The chat inside is the same `ChatWidget`**, in the store's colours and fonts and the language of the market chosen for the site. It
   tells the page holding it when it is ready, opened and closed (`FrameMessage`), and the loader sizes the frame: the button's corner when
   closed, the right-hand edge of the window (the whole window on a phone) when open. The loader listens only to messages from its own frame
   and origin.
4. **Its requests go to Kaizena Flow's own origin**, so the chat's routes keep refusing every other site (`sameSite()`, unchanged). Each
   request carries the site's key and the page's host; `chatPlace()` turns them into the desk (`embedPlace()`), with `site.embed` set.

Why a frame and not a script that draws the chat on the owner's page: the chat's routes need not be opened to other origins (no CORS, no
weaker `sameSite()`), the site's CSS cannot break the chat nor the chat's the site, and no React or Kaizena Flow code runs on the owner's
page beyond 50 lines of loader.

## 2. Decisions

- **One site is one host**, and its `www.` twin is the same site. Typed as the owner pleases (`normalizeHost()`): `Example.com`,
  `https://www.example.com/contact`. Only `https` pages show the chat. At most 5 sites per desk (`EMBEDS_MAX`).
- **The tag must be found before the chat shows** (the owner asked that it be restricted to the site holding the tag). The site's front
  page is fetched through `safeFetch()` (no private addresses, a redirect within the site followed, never to another site) and searched
  for the loader's script with the site's key (`tagFoundIn()`). A tag added by a tag manager is not in the HTML, so a TXT record
  `kaizena-flow-chat={key}` on the host proves the site instead (`dnsFound()`). The check runs when the site is added, on *Check now*,
  and when the frame is opened on a site not yet found (at most every 10 minutes, the time claimed first so many visitors ask once). Once
  found, a site stays found until the owner removes it: a cookie wall or an outage must not switch a working chat off.
- **The key is public** (anyone can read it in the site's HTML) and proves nothing alone: the frame's `frame-ancestors` and the found
  tag do. A host can be on several desks (a squatter cannot block the real owner), but only a desk whose tag is on the site shows a chat.
- **Step 1 answers from the knowledge base alone.** On an embedded site the AI has one tool, `search_content` over the desk's knowledge
  base documents (`searchKnowledge(…, {documentsOnly: true})`, `embedTools()`, `embedTool()`), and the prompt says so
  (`systemPrompt({embed})`): no products, prices, store pages, `navigate` or order tools. The store's pages are another site's, and
  answering about the owner's website from them would be wrong. Step 2 adds the site's own pages.
- **Nobody signs in there.** A store's customer cookie in a third-party frame is blocked by Safari and Chrome, and an external site's
  visitors are not the store's customers. So `sessionCustomer()` is null for an embed, the sign-in, sign-in code and confirm routes refuse,
  and support's order tools are not offered (`runSupportTurn()`). The email card works as everywhere: a visitor waiting for a person can
  leave an email, and the answer email's link opens the conversation on the store's own return page.
- **The staff see where it started**: `page_path` holds the site's host with the page's path (`www.example.com/pricing`), shown as
  *Started on*. A column for the site (`support_conversations.embed_id`) and per-site figures come in step 3.
- **A private store (D339) still answers there**: the owner put the chat on their own site, and it reads only the knowledge base. A store
  that is not open is a 404, as its own chat is.
- **Kaizena Flow too** (the parity rule): the platform's support settings have the same card, and Kaizena Flow's desk can be put on
  another website of its own (`store_id` null).
- **Never copied** with a store (`store-copy-rules.ts`): a copy is another business, whose website must carry its own tag.
- **Nothing new reaches the prompt as free text**: the host is checked to be a host name, and the page's path was already sent.

## 3. What step 1 built

| Part | Where |
|---|---|
| Table `commerce.support_embeds` (host, public key, market, privacy page, found by page or DNS, last check) | `src/db/schema.ts`, `20261113065223_support_embeds`, `20261113065235_support_embeds_rules` |
| The pure rules: hosts, keys, the tag, finding it, framing | `src/lib/support-embed.ts` |
| Adding, checking, removing; the frame's lookup | `src/server/support-embeds.ts` |
| The loader | `public/embed/chat.js` |
| The frame's root and page | `src/app/embed/layout.tsx`, `src/app/embed/chat/[key]/[host]/page.tsx`, `FrameChat` in `src/components/site-chat.tsx` |
| The widget in a frame | `ChatWidget`'s `embedded` prop: the host page's path, the messages to the page, no page opened |
| The routes | `chatPlace()` → `embedPlace()` in `src/server/chat-route.ts` |
| The AI | `embedTools()`, `systemPrompt({embed})` in `src/lib/chat.ts`; `embedTool()` in `src/server/chat-agent.ts` |
| The admin | *Chat on your own website* on Support → Settings, a store's and Kaizena Flow's (`SupportEmbedsCard`) |
| Tests | `src/lib/support-embed.test.ts`, `src/db/support.test.ts` 11 |

## 4. The steps after

**Step 2 — the site's own pages.** A crawler for a found site only: `robots.txt` and the sitemap read as `old-shop.ts` reads them, then
pages on the site's host alone through `safeFetch()` (a redirect off the host dropped), text by `web-page-text.ts`, cut into
`knowledge_chunks` with a new source (the site and the page's address) and embedded by the five-minute cron as pages are. Re-read weekly
and on *Read the site again*, within a page cap per site (`PAGES_PER_DAY` today is 200). The site's pages are outside text reaching a
prompt, so this step adds an agent-eval case with instructions hidden in a page, and a new recording. `search_content` there then answers
from the site's pages as well, with the page's full address as a link chip that opens in the site's own tab.

**Step 3 — per site.** The chat's colour, side and greeting per site; the language from the page's own `<html lang>` when the store has
it; the page's path sent again when a single-page site moves (`history` events in the loader); `support_conversations.embed_id` and the
site in the inbox's filters and the reports; a store feature and plan limit for the number of sites (D178, D314).

**Step 4 — WordPress.** The plugin (D169) gets *Show the chat on this site*: it adds the site to the desk through its connection and puts
the tag in the footer itself, so a WordPress owner never copies anything.

## 5. Needs human review

- The owner of the website is the controller of their visitors' conversations and Kaizena Flow its processor, as for a store's own chat;
  the data processing terms should say that the chat may run on the owner's other websites too.
- The chat's notice links the site's own privacy page when one is given; without one it links none, and the site's own privacy notice
  should mention the chat.
