import type { SupportMessages } from "@/lib/admin-messages/support.en";
import type { SupportMode } from "@/lib/support-rules";

import { Card } from "@/components/admin/ui";

/**
 * The desk's address for email (D332, `docs/support.md` step 16): the owner forwards their support address here and each email
 * becomes a conversation. Shown to whoever may read the desk's settings; nothing to change.
 */
export function SupportEmailCard({
  address,
  mode,
  keyRefused = 0,
  words,
}: {
  address: string | null;
  mode: SupportMode;
  /** Emails waiting because Resend refused the key that reads them. */
  keyRefused?: number;
  words: SupportMessages["email"];
}) {
  return (
    <Card title={words.title} description={words.description}>
      {address ? (
        <div className="flex flex-col gap-2">
          <p className="text-eyebrow text-muted">{words.address}</p>
          <code className="w-fit select-all rounded-panel bg-sunken px-3 py-2 text-body text-ink">{address}</code>
          {mode === "off" && <p className="text-body text-muted">{words.off}</p>}
          {keyRefused > 0 && (
            <p role="status" className="rounded-panel border border-warning-line bg-warning-soft px-3 py-2 text-body text-warning-text">
              {(keyRefused === 1 ? words.keyRefused.one : words.keyRefused.many).replace("{n}", String(keyRefused))}
            </p>
          )}
        </div>
      ) : (
        <p className="text-body text-muted">{words.notSetUp}</p>
      )}
    </Card>
  );
}
