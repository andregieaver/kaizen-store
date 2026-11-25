# Kaizena Flow for Figma

The plugin behind *Send to my store* (D898 F1 to F3, `docs/design-tools.md`). A store's owner selects a frame in Figma and presses
**Send to my store**; it arrives in their store as a page draft, built by the same engine that copies web pages, with its pictures in the
store's media library. **Send colours and type** brings the file's colour styles, colour variables and text styles as a look in the
store's theme library, to try and make live in Design settings. Nothing is published by it, and no look is made live.

## Files

- `manifest.json`: the plugin's name, its files and the only hosts it may reach (Kaizena Flow and its file storage).
- `code.js`: runs in Figma's sandbox. Reads the selected frames (boxes, auto layout, fills, corners, shadows, text runs) and their pictures,
  and keeps the store's token in Figma's client storage. It never reaches the network.
- `ui.html`: the plugin's window. Signs in, sends the pictures (`POST /api/admin/v1/media/uploads`, the bytes to the one-time address, then
  `POST /api/admin/v1/media`) and the frames (`POST /api/admin/v1/pages/import`), or the file's colours and text styles
  (`POST /api/admin/v1/themes/import`). The file remembers the look it made for each store, so sending again updates that look.

Plain JavaScript and HTML, so there is nothing to build.

## Signing in

A plugin cannot follow a redirect back, so it signs in as Figma's docs show for plugins:

1. The window asks Kaizena Flow for a sign-in (`POST /api/plugin/sign-in`) and shows its eight-letter code.
2. It opens the owner's admin at `/admin/account/plugin?code=…` in the browser. The owner checks the code, picks the store and presses
   **Connect Figma**.
3. The window asks every two seconds (`POST /api/plugin/sign-in/poll`) and is given an Admin API token for that store, once. The token is
   listed under Developer, API tokens as *Figma plugin*, where the owner revokes it. Signing in again replaces it.

## Trying it

1. In the Figma desktop app: Plugins, Development, **Import plugin from manifest…**, and choose `manifest.json` here.
2. For a local server, change `BASE` in `ui.html` to `http://localhost:3000` (allowed in development by `devAllowedDomains`).

## Publishing (the owner's step)

Figma gives a plugin its id when it is created in the owner's Figma account (Plugins, Development, **New plugin…**). Put that id in
`manifest.json` in place of `REPLACE-WITH-THE-ID-FIGMA-GIVES`, then publish it to the Community from the same menu. Figma reviews it
(two-step sign-in on the account, the data security form); `docs/design-tools.md` section 6 has what Figma asks.
