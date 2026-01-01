import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, parseSessionValueEdge } from "@/lib/authEdge";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // lascia passare asset e API
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api")
  ) {
    return NextResponse.next();
  }

  // pagine pubbliche
  if (pathname === "/" || pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = await parseSessionValueEdge(cookie);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // /admin -> solo admin
  if (pathname.startsWith("/admin")) {
    if (session.role !== "admin") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  // /user -> area admin + amministrativo (PV NON deve entrarci)
  if (pathname.startsWith("/user")) {
    if (session.role === "punto_vendita") {
      const url = req.nextUrl.clone();
      url.pathname = "/pv/inventario";
      return NextResponse.redirect(url);
    }

    if (session.role !== "admin" && session.role !== "amministrativo") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  }

  // /pv -> area PV (e admin se vuoi)
  if (pathname.startsWith("/pv")) {
    if (session.role !== "admin" && session.role !== "punto_vendita") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};


