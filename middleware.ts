import { NextRequest, NextResponse } from "next/server";

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Ernesto"',
    },
  });
}

export function middleware(req: NextRequest) {
  const USER = process.env.ERNESTO_USER;
  const PASS = process.env.ERNESTO_PASS;

  if (!USER || !PASS) return unauthorized();

  const auth = req.headers.get("authorization");
  if (!auth) return unauthorized();

  const [scheme, encoded] = auth.split(" ");
  if (scheme !== "Basic" || !encoded) return unauthorized();

  const decoded = Buffer.from(encoded, "base64").toString("utf-8");
  const [user, pass] = decoded.split(":");

  if (user === USER && pass === PASS) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/(.*)"],
};
