import "server-only";

import { sendcloudPartnerId } from "@/lib/env";
import { nextPage, parseSenders, SENDCLOUD_API, sendcloudHeaders, sendcloudProblem, senderProblem, type SendcloudSender } from "@/lib/sendcloud";
import type { CarrierContext, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

/**
 * Sendcloud's connection (D483, `docs/sendcloud-labels.md`), on the shop's own Sendcloud account: the public and secret key of a
 * Sendcloud API integration, sent as Basic auth to API v3. Step 1 is the connection: *Check connection* and the shop's sender
 * addresses, read with a harmless `GET /addresses/sender-addresses`. Labels, checkout options, tracking and return labels follow
 * in steps 2 to 5. Sendcloud has no test system, so the store's environment changes no host: from step 2 the test environment
 * books only the free `SENDCLOUD_TEST_OPTION`. Every call has a timeout, and a refusal is a plain sentence for the owner.
 */

const TIMEOUT_MS = 12_000;
/** At most this many pages of sender addresses (100 each) are read. */
const SENDER_PAGES = 5;

type Fetch = typeof fetch;

type Answer = { ok: true; json: unknown; link: string | null } | { ok: false; problem: string; status: number };

async function call(fetcher: Fetch, context: CarrierContext, url: string): Promise<Answer> {
  const publicKey = context.details.publicKey ?? "";
  const secretKey = context.secrets.secretKey ?? "";
  if (!publicKey || !secretKey) return { ok: false, problem: "Save the public and secret key of your Sendcloud API integration first.", status: 0 };
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "GET",
      headers: sendcloudHeaders({ publicKey, secretKey }, sendcloudPartnerId()),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, problem: "Sendcloud did not answer. Try again in a moment.", status: 0 };
  }
  const json: unknown = await response.json().catch(() => null);
  return response.ok ? { ok: true, json, link: response.headers.get("link") } : { ok: false, problem: sendcloudProblem(response.status, json), status: response.status };
}

/** The sender addresses of the shop's Sendcloud account, every page up to `SENDER_PAGES`, or why they could not be read. */
export async function readSenders(context: CarrierContext, fetcher: Fetch = fetch): Promise<{ ok: true; senders: SendcloudSender[] } | { ok: false; problem: string }> {
  const senders: SendcloudSender[] = [];
  let url: string | null = `${SENDCLOUD_API}/addresses/sender-addresses?page_size=100`;
  for (let page = 0; url && page < SENDER_PAGES; page += 1) {
    const answer = await call(fetcher, context, url);
    if (!answer.ok) return { ok: false, problem: answer.problem };
    const found = parseSenders(answer.json);
    if (!found) return { ok: false, problem: "Sendcloud answered, but not with a list of sender addresses." };
    senders.push(...found);
    url = nextPage(answer.link);
  }
  return { ok: true, senders };
}

export function createSendcloudAdapter(fetcher: Fetch = fetch): ShippingCarrierAdapter {
  return {
    id: "sendcloud",
    /** The keys work, the account has a sender address, and the one the store chose is still there. */
    async check(context) {
      const read = await readSenders(context, fetcher);
      if (!read.ok) return read;
      const problem = senderProblem(read.senders, context.details.senderAddressId);
      return problem ? { ok: false, problem } : { ok: true };
    },
  };
}
