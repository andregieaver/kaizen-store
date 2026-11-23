import { receiveSesEvent } from "@/server/ses-events";
import { sesSettings } from "@/server/ses";

export const maxDuration = 30;

/**
 * Amazon SES's events about marketing email (D872), sent by SNS from the topic `AWS_SES_EVENTS_TOPIC_ARN` names: delivered, bounced, marked
 * as spam, rejected. Only SNS's signed messages from that topic are trusted; the topic's subscription is confirmed here.
 */
export async function POST(request: Request) {
  const answer = await receiveSesEvent(await request.text(), sesSettings());
  return new Response(answer.text, { status: answer.status });
}
