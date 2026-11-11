# Apps from other companies: what is built and what the owner decides (11 November 2026)

A plan to decide on before anything more is built. D405 (29 October 2026) stays in force: the directory opens when outside developers ask
for it, and never before the legal texts are approved.

## 1. Already built (D441, wave 14 unit D, 4 November 2026)

- **Developers.** Any account accepts the developer terms at Account → Developer and makes up to 25 apps: name, logo, homepage, privacy
  policy, support email, HTTPS redirect URIs, the scopes and Admin API powers it asks for, and an events address.
- **Installing.** An owner installs an app on one store through a consent screen that lists exactly what it asks for, in words. Its `kfa_`
  tokens work on the Admin API and the owner MCP, on that store only, and every call is checked against the installer's own permission now.
- **Removing.** Settings → Apps and API lists installed apps with *Remove*; ending an installation (also when the installer leaves) revokes
  its tokens at once, switches its events off and sends `app.uninstalled`, then `store.erase_requested` 48 hours later.
- **Review.** A *Listed* app waits on Platform → App listings; approve with a note or decline with a reason, emailed to the developer.
- **Docs.** *A first app* (a Node script), the OpenAPI document with the apps' OAuth scheme, and the owners' *Apps from other companies*.

The parity row `platform.app-store-and-ecosystem` was still *missing*; it is now *partial*, bucket B (waits for the owner's legal approval).

## 2. What is left, and who it waits for

| Step | What | Waits for | Size |
|---|---|---|---|
| 1 | Legal reading of the developer terms, the data processing terms an app accepts, and the review checklist (`content/docs/developers/apps/`) | A lawyer, then the owner | Owner |
| 2 | The directory page at `kaizenaflow.com/apps` (approved apps only, search, an app's page with *Install*), and `APP_DIRECTORY_OPEN` on; link it from *Custom Extensions* and *Integrations* | Step 1, and developers asking (D405) | About a day |
| 3 | *Suspend* on Platform → App listings: block an app everywhere at once (every installation ends, as an erased developer's apps do today) | Nothing; worth doing with step 2 | Half a day |
| 4 | Extension points: an app adds a settings page in the admin (in a sandboxed frame on the app's own host, given a short-lived token) and a block in the page builder (rendered from the app's own data, never its script on the store's origin) | A first developer who needs one | One to two weeks |
| 5 | Paid apps: a developer charges stores through Kaizena Flow (Stripe Connect, a share kept), with the invoice and VAT that come with being the seller of record | An owner decision on taking a share and the tax position | Two to three weeks plus advice |

## 3. Recommendation

1. **Now:** send the three drafts to a lawyer (step 1). Nothing else should be built until it is back.
2. **When the first outside developer asks:** steps 2 and 3 together, in one change.
3. **Later, only on demand:** step 4 for the first developer who needs a screen of their own; step 5 only once there are paid apps
   developers want to sell, because being the seller of record for others' apps brings VAT and consumer-law duties.

Until then, owners connect their own tools with a custom app (D363), the Admin API tokens (D355) and event endpoints (D354), which need
none of the above.
