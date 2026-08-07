import { NextResponse } from "next/server";

/**
 * Ernesto is no longer protected by the temporary shared HTTP Basic Auth.
 * Individual application access is handled by the app itself.
 */
export function middleware() {
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
