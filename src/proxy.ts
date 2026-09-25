import { NextResponse, type NextRequest } from "next/server";
import { decryptSession, SESSION_COOKIE } from "@/lib/session";

// Optimistic auth check only; pages still verify the user against the database.
export async function proxy(req: NextRequest) {
  const session = await decryptSession(req.cookies.get(SESSION_COOKIE)?.value);
  const path = req.nextUrl.pathname;
  if (!session && (path.startsWith("/dashboard") || path.startsWith("/locations"))) {
    return NextResponse.redirect(new URL("/login", req.nextUrl));
  }
  if (session && (path === "/login" || path === "/signup")) {
    return NextResponse.redirect(new URL("/dashboard", req.nextUrl));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/locations/:path*", "/login", "/signup"],
};
