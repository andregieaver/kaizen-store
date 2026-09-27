import { connection } from "next/server";

import { calendarForToken } from "@/server/calendar-sync";

/**
 * A room's, item's or staff member's taken days as an iCal file (D67), at
 * a secret address for Airbnb, Booking.com and the like to read:
 * `/api/calendar/{token}.ics`. Read fresh every time.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/calendar/[file]">) {
  await connection();
  const token = (await params).file.replace(/\.ics$/i, "");
  const calendar = await calendarForToken(token);
  if (!calendar) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(calendar.file, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'inline; filename="calendar.ics"',
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
