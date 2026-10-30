// Prints `GIFT_CARD_HASH_KEY` and `RECOVERY_CODE_HASH_KEY` as they are today, made from the settings key, so they can be set in production
// as keys of their own before `SETTINGS_ENCRYPTION_KEY` is rotated (step 1 of docs/runbooks/key-rotation.md). Gift card and recovery
// codes are kept only as hashes; with these set, a new settings key changes none of them.
//
//   SETTINGS_ENCRYPTION_KEY=... node scripts/hash-keys.mjs
//
// It prints secrets: run it on your own machine, paste the two values into Vercel's Production settings, and clear the terminal.
import { derivedHashKeys } from "./lib/hash-keys.mjs";

const keys = derivedHashKeys(process.env.SETTINGS_ENCRYPTION_KEY);
if (!keys) {
  console.error("Set SETTINGS_ENCRYPTION_KEY (the production value, base64 of 32 bytes) for this command.");
  process.exit(1);
}
for (const [name, value] of Object.entries(keys)) console.log(`${name}=${value}`);
