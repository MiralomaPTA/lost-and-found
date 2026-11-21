import { NextResponse, type NextRequest } from "next/server";
import { CODE_COOKIE, cookieOptions, HEX32, PHONE_COOKIE } from "@/server/cookies";

/**
 * Keeps an active phone remembered. Every page request pushes the phone's
 * cookies a year out again, so a family only loses its phone ID after a year
 * without visiting, which is also when the clear-out deletes the phone's file.
 *
 * Only well-formed values are renewed, and only their expiry changes; pages
 * still check what the cookies say.
 */
export function proxy(request: NextRequest) {
  const response = NextResponse.next();
  if (request.method !== "GET") return response;
  for (const name of [PHONE_COOKIE, CODE_COOKIE]) {
    const value = request.cookies.get(name)?.value;
    if (value && HEX32.test(value)) response.cookies.set(name, value, cookieOptions);
  }
  return response;
}

export const config = {
  // Not static files or photos: a Set-Cookie header would stop the CDN from caching them.
  matcher: ["/((?!_next/static|_next/image|photos/|icon.svg|favicon.ico|robots.txt).*)"],
};
