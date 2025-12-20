import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

function getSession(req: NextRequest) {
  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  return parseSessionValue(cookie);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Lascia passare file statici e API
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  // Rotte pubbliche
  if (pathname === "/" || pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  const session = getSession(req);

  // Se non loggato, fuori da tutte le pagine protette
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // ADMIN area
  if (pathname.startsWith("/admin")) {
    if (session.role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // RIORDINO (ufficio)
  if (pathname.startsWith("/user")) {
    if (session.role !== "admin" && session.role !== "amministrativo") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // PUNTO VENDITA (inventario) - lo implementeremo dopo
  if (pathname.startsWith("/pv")) {
    if (session.role !== "admin" && session.role !== "punto_vendita") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // Tutto il resto: permetti
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
