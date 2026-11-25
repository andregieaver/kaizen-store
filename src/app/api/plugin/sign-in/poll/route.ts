import { pluginPreflight, pollSignInRequest } from "@/server/plugin-route";

/** A design tool's app asks whether its sign-in was approved, and takes its token once it was (D898 F1). */
export const POST = (request: Request) => pollSignInRequest(request);
export const OPTIONS = () => pluginPreflight();
