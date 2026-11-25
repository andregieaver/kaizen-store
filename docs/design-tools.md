# Figma, Miro and Canva (D898)

The owner, 25 November 2026: *look at what needs to be done to tightly and seamlessly integrate with Figma, Miro and Canva*, then
*start with Canva, write the plan doc and begin step 1*. This file is that plan. The research behind it (each tool's APIs, sign-in, plan
gates, reviews and where it keeps data, read from their developer docs on 25 November 2026) is summarised in section 6; the rules for
what is built are in `docs/rules/admin/integrations.md` (*Canva*).

## 1. The shape

Each tool gets two halves:

- **Buttons in our admin** that use the person's own account at the tool, through its REST API: *Edit in Canva*, *Send to my store*
  (Figma), *Plan on Miro*.
- **A small app inside the tool** that signs in to Kaizena Flow (our OAuth 2.1 server, D439, and developer apps, D441) and sends work to
  the store: a Canva app, a Figma plugin, a Miro panel.

Three rules hold for all of them:

1. **The connection is the person's, not the store's** (`commerce.design_connections`, one per account and tool). A Canva design's edit
   link works only for the Canva user who owns it, and Figma files and Miro boards are a person's too, so each owner or staff member connects
   their own account once and it works in every store they work in, and in Kaizena Flow's own admin. Erasing the account deletes it.
2. **Nothing from a tool is published by itself.** Every way in ends as a new media library item, a page draft or an installed look,
   through the screen's own writer (`storePicture()`, `savePage()`, `switchToInstall()` stays the owner's press).
3. **We send only what the person presses**: a picture, a product's facts, a page's layout. Never a customer's name, address or order.
   Figma and Canva keep files in the US unless the person's team pays them for Enterprise (Miro keeps them in the EU), so the connect
   screen says so; the tokens are kept encrypted here, in Dublin.

## 2. Canva first (the owner, 25 November 2026)

Owners change pictures every week, *Edit in Canva* works on a free Canva account, and its connection is what Figma and Miro reuse.

| Step | What | State |
|---|---|---|
| C1 | **Connect Canva** (a person's account, OAuth with PKCE, tokens sealed and refreshed under the row's lock, Canva's refresh tokens being single use), **Edit in Canva** and **Import from Canva** in the media library, for stores and Kaizena Flow's own library alike. The edited copy is a new library item beside the original (`made_by = 'canva'`, `edited_from`). | Built (25 November 2026, f78b932) |
| C2 | *Edit in Canva* on every picture field: the page builder's picture fields (stores' and Kaizena Flow's own) and the product editor's photos, the edited copy put where the old one was (one Undo step in the builder, the product's own save in the editor). Canva opens in a tab of its own so the editor keeps its unsaved changes; *Return* lands on `/admin/account/canva-back`, which tells the field's tab and closes. | Built (this change) |
| C3 | Social post pictures into Canva. Today a post's picture is drawn on request and never stored (D870 C2); editing it keeps a copy in the library, which needs the owner's yes. | Waits for the owner |
| C4 | A product into a Canva brand template (Canva Pro and up: autofill), with its photo, name and the shop's price line worked out in code (`priceLines()`), never a model's. | Later |
| C5 | A Canva app inside Canva: *Publish to Kaizena Flow* from Canva's share menu (the content publisher intent) and a panel of the store's pictures and products. Signs in as one of our developer apps; its own review at Canva, with EU trader checks. | Later |
| C6 | The AI manager with Canva's MCP server: custom apps (D363) learn MCP's OAuth sign-in (discovery, PKCE, rotating refresh). | Later |

### What C1 does

- **Connect.** *Connect Canva* (in the media library, on the store's Integrations under *Design*, and on Account → Connected apps) sends the
  person to Canva's consent page with the scopes C1 needs and nothing more (`CANVA_SCOPES`), a PKCE challenge and a signed state in a
  cookie that only the callback's path receives. The callback checks the state, that the person signed in now is the one who pressed,
  spends the code, reads who they are at Canva (their display name) and keeps the tokens encrypted. A new connection replaces the
  person's old one. *Disconnect* revokes the refresh token at Canva and deletes the row.
- **Edit in Canva** on a library picture: the picture's own file (read from Storage by its row, never an address) goes up to the person's
  Canva as an asset, a design of the picture's size is made with it, and the browser goes to the design's edit link with a one-time
  `correlation_state`. Canva's *Return* button brings the person back to `/api/integrations/canva/return`, where Canva's signed note
  (`correlation_jwt`, checked against Canva's published keys) says which design; the edit row it names must be the signed-in person's.
  The library then exports the design (PNG) and keeps it as a new picture edited from the original. A design can be brought back again
  later from the same picture (*Bring back from Canva*), since Canva tells us nothing when a design changes.
- **Import from Canva**: the person's latest designs, searchable, with their thumbnails passed through our own address (signed, Canva's
  export hosts only); a press exports the first page and keeps it in the library.
- Every picture from Canva is shrunk on the server as uploads are (WebP, 1600 px, the 480 and 800 px copies), counts against the store's
  storage, gets its alt text from the AI as uploads do, and is audited (`media.canva_imported`, `media.canva_edited`) without a token.

### What C2 does

- **Where.** Every picture field under the page builder (`ImageUploadButton`, through `CanvaFieldProvider`, for a store's pages and Kaizena
  Flow's own) and each photo of a product in the product editor. Kaizena Flow sells plans, not goods, so it has no product editor to match.
- **How.** *Edit in Canva* opens a new tab on the press (a tab opened later is a pop-up the browser stops), asks the route to send the
  field's picture to Canva (found by its address among the site's own library, `place = 'field'`), and sends that tab to Canva's edit
  link. The editor stays as it is, with its unsaved changes. Canva's *Return* lands on `/admin/account/canva-back`, which tells the
  field's tab on this site's `BroadcastChannel` and closes; the field also asks where the edit stands every few seconds and when its tab
  is looked at again, for a browser that is not told. Then the edited copy is brought into the library, as in C1, and takes the field's
  place: one change in the builder (so one Undo), and a changed photo the product's own save keeps, its description kept.
- **Not connected.** The field offers *Connect Canva* in a new tab, which comes back to the same back page; the field then offers *Edit in
  Canva*. A product's photos go through `/admin/{store}/products/canva` (`products:write`, edit and bring back only); the builder through
  the library's route (`website:write`).

### What the owner sets up at Canva (once)

Canva's Developer Portal (two-step sign-in on the account): a **public integration** named *Kaizena Flow*, with

- redirect URL `https://kaizenaflow.com/api/integrations/canva/callback`,
- return navigation on, return URL `https://kaizenaflow.com/api/integrations/canva/return`,
- the scopes `asset:read asset:write design:meta:read design:content:read design:content:write profile:read`,

then `CANVA_CLIENT_ID` and `CANVA_CLIENT_SECRET` in Vercel (production). Without both, nothing Canva is offered. Until Canva has reviewed
the integration, only the developer's own Canva team can connect; submit it for review (a test login, a short video, Canva's
questionnaire) once C1 is live.

## 3. Figma

| Step | What |
|---|---|
| F1 | **A Figma plugin**, *Send to my store*: it signs in to Kaizena Flow and sends the selected frames (boxes, text, picture bytes, styles and variables; plugins read variables on every plan, the REST API only on Enterprise). Needs a sign-in a plugin can use (it cannot take a redirect: the device grant, RFC 8628, or Figma's polling pattern) and CORS on the Admin API for the plugin's frame. |
| F2 | **A page draft** from the frames through the page copy engine: an adapter from Figma's nodes to `PageCapture` (`src/lib/replicate-capture.ts`), so a frame gets `buildReplica()`'s grids, style model and refine passes, compared against Figma's own render of the frame. Fonts install where Google has them (D59); the summary names the rest. |
| F3 | **A look from the file**: colours and type as an installed look, checked by `themeWarnings()`, made live only by the owner. Admin API routes to read and write a look, text styles and saved colours. |
| F4 | **A Figma REST app** for webhooks (*the design changed: bring it again?*). REST file reads are 20 a month on Starter and view seats, so it is never the main path. |
| F5 | **Back to Figma**: the same plugin draws a page and the theme as frames and variables. |
| F6 | **Our MCP in Figma's agent and Make** as a custom connector, registered as one of our developer apps. Figma's own MCP server takes only clients on its list (we join the waitlist), so the AI manager uses it later. |

## 4. Miro

| Step | What |
|---|---|
| M1 | **Connect Miro** (the same `design_connections`, an install link: no review needed to start). |
| M2 | **Plan on Miro**: the site map from pages and menus as shapes and lines, the product range as cards with pictures, a campaign as frames. |
| M3 | **Make from a frame**: its notes, shapes, cards, pictures and lines go to the AI builder as data (never as instructions) and come back as page drafts (`build_page` jobs). |
| M4 | **A look from a mood board**: colours picked in code by `designedTheme()`, installed and not live. |
| M5 | **A panel app inside Miro**: drag products and pictures onto the board, as cards that open them in Kaizena Flow. The Marketplace needs partner approval, 50 monthly users and an 8 to 12 week review, so it starts as an install link. |
| M6 | The AI manager with Miro's MCP server (after C6). |

Miro has sent no events since December 2025: changes on a board are read when the person asks.

## 5. Shared pieces

| Piece | Today | Needed by |
|---|---|---|
| A person's account at a tool | `design_connections` (C1) | Every step |
| Apps inside the tools signing in | OAuth 2.1 server (D439), developer apps with secrets (D441) | C5, F1, F6, M5: plus a plugin sign-in and Admin API CORS for F1 |
| The Admin API for designs | Page drafts and publishing, media uploads, products (D355, D440) | F3: a look, text styles, saved colours; F2: a page import route |
| One import engine | The page copy's `PageCapture` and `buildReplica()` (D150) | F2 |
| The AI manager using outside MCP servers | Custom apps with a fixed token (D363) | C6, F6, M6: MCP OAuth |
| A design shown on a page | YouTube and Vimeo load on a press after consent | An embed block for Figma prototypes, Miro boards and Canva designs |

Kaizena Flow's own site runs from its own store (D484) and its admin has the same media library, so each step reaches it in the same
change (`docs/platform-parity.md`).

## 6. The tools' own rules (25 November 2026)

| | Figma | Canva | Miro |
|---|---|---|---|
| Before others can use our app | Public app review, and Community review for a plugin. No time published. | Review of the public integration (apps on preview APIs cannot pass); the Marketplace app reviewed apart, with EU trader checks. No time given. | An install link works without review; the Marketplace needs partner approval, 50 monthly users two months running, 10 organisations and 8 to 12 weeks. |
| Sign-in and tokens | OAuth, PKCE optional; 90-day tokens, a reusable refresh token. | OAuth with PKCE; about 4-hour tokens, each refresh token works once. | OAuth; 60-minute tokens, 60-day refresh tokens, both changing at every refresh. |
| The person's plan | The plugin on every plan; REST variables on Enterprise only. | Free: edit, export, return. Pro: templates, autofill, resize. Transparent PNG needs a paid plan. | API and apps on every plan; Free has three editable boards. |
| Where files live | US; the EU on Enterprise, in part. | US; the EU on Enterprise. | EU (Ireland) on every plan; AI and beta features may run outside it. |
| Tells us when something changes | Yes: file updated, library published. | Comments and shares only. | No (webhooks removed December 2025). |
| Their MCP server | Listed clients only; a waitlist. | Open with an OAuth client since October 2026. | OAuth with open registration; daily caps (100 calls on Free). |

Read only as search excerpts, so to check before relying on them: Canva's and Miro's data-residency pages, whether their embeds set
cookies, and the end of the Canva Button outside China.
