# Rotating the settings key

`SETTINGS_ENCRYPTION_KEY` encrypts every secret Kaizena Flow keeps in the database (`src/lib/secret-box.ts`, AES-256-GCM) and is the
root of the keys made from it for one use each (`docs/security.md` section 4). This is how it is changed without losing a secret, a gift
card or a recovery code (PSI SEC-06, D410). Run it on a schedule you choose, and at once if the key may have leaked (then also
`docs/runbooks/breach.md` 4.1: every secret it opened is to be treated as leaked and rotated at its source).

How it works: each secret names the key it was kept under (`v2.<kid>.<iv>.<tag>.<ciphertext>`, the key id eight hex digits of the key's
SHA-256; older secrets are `v1.…` with no id). While `SETTINGS_ENCRYPTION_KEY_PREVIOUS` is set, the server reads with either key and
writes with the current one only, and the five-minute dispatcher (`reencryptSecrets()`, `src/server/secret-rotation.ts`) writes every
secret not yet under the current key again under it, 200 a run. Gift card and recovery codes are kept only as hashes, so they cannot be
moved: they are hashed under keys of their own (`GIFT_CARD_HASH_KEY`, `RECOVERY_CODE_HASH_KEY`) that do not change with this one.

## Once, before the first rotation: the hash keys of their own

Until they are set, gift card and recovery code hashes use keys made from the settings key, and a new settings key would end every gift
card's code and every recovery code for good. Set them to exactly what they are today, so nothing changes for anyone:

1. On your own machine, with the production value of the settings key:
   `SETTINGS_ENCRYPTION_KEY='<production value>' node scripts/hash-keys.mjs`. It prints two lines, `GIFT_CARD_HASH_KEY=…` and
   `RECOVERY_CODE_HASH_KEY=…` (secrets: clear the terminal after).
2. Vercel → the project → Settings → Environment Variables → Production: add both, as sensitive.
3. Redeploy. Check: a gift card bought before still pays at checkout, and a recovery code still signs in (or: the drill below).

Keep both for good. They are rotated only by issuing new gift card codes and new recovery codes, which is a different decision.

## The rotation

1. Make a new key: `openssl rand -base64 32`.
2. Vercel → Production: set `SETTINGS_ENCRYPTION_KEY_PREVIOUS` to the **current** value of `SETTINGS_ENCRYPTION_KEY`, then set
   `SETTINGS_ENCRYPTION_KEY` to the new key. Both sensitive.
3. Redeploy (Deployments → Redeploy). Every secret stays readable: the old ones through the previous key.
4. Wait for the move. Every five minutes the dispatcher logs `secrets.rotation` with `moved`, `failed` and `left` (Vercel → Logs, search
   `secrets.rotation`). That is 2,400 secrets an hour.
5. When `left` is 0, remove `SETTINGS_ENCRYPTION_KEY_PREVIOUS` and redeploy. From then on the old key opens nothing kept here.
6. Write the date in `docs/decisions.md` (D410, rotations) and where the old key was kept, destroy that copy.

`failed` counts `v1` secrets (the format before key ids) that neither key opens, each logged as `secrets.rotation_unreadable` with its
table and column (never a value). They were unreadable before the rotation too (kept under a key long gone): clear the value and ask its
owner to enter it again (the page that keeps it says which: Platform → AI, a store's carrier, webhook or custom app settings). They are
left in place, so `left` cannot reach 0 while one remains; `failed` equal to `left` means only those are left. A `v2` secret naming a key
the server does not have is never picked and never counted.

## What a new key ends anyway

Keys made from the settings key for short-lived things change with it, by design:

| Made from it | What happens |
|---|---|
| Edit passes, a private store's passes | a person enters the edit or store password again |
| Sign-in counters, sign-up and comment buckets | the counts start again |
| Visit hashes (analytics) | a visitor seen today counts once more today |
| The avatar proxy's addresses | the pictures load from their new addresses |

## A drill

On a preview or a copy, never production: set a previous key and a new one as above, save a secret (Platform → AI, a key), and check it
still reads; run the dispatcher (`/api/cron/cart-reminders` with the cron secret) until `left` is 0; remove the previous key and check the
secret still reads. `src/server/secret-rotation.int.test.ts` and `src/lib/secret-box.test.ts` hold the same steps in code.
