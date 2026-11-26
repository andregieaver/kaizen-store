import { FACEBOOK_CONNECTION } from "@/server/facebook-pages";
import { connectionCallback } from "@/server/social-connect-routes";

/** Back from Facebook's sign-in with what the owner shared (D870 S1.2b), to the store's Social posts. */
export function GET(request: Request) {
  return connectionCallback(FACEBOOK_CONNECTION, request);
}
