import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIE_NAME, parseSessionValueEdge } from "@/lib/authEdge";

// Il middleware verifica il profilo firmato nel cookie. Le API e i layout
// continuano a verificare i permessi aggiornati sul database.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  // Il gateway verifica il profilo firmato nel cookie (difesa aggiuntiva).
  // Le API continuano a controllare i permessi aggiornati nel database.
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    // Login/logout devono rimanere disponibili anche con sessioni vecchie.
    if (pathname === "/api/auth/login" || pathname === "/api/auth/logout" ||
        pathname === "/api/auth/bootstrap") {
      return NextResponse.next();
    }

    const session = await parseSessionValueEdge(req.cookies.get(COOKIE_NAME)?.value);
    if (!session) return NextResponse.next(); // L'autorizzazione resta nell'API.

    const profile = session.accessProfile ?? "standard";
    if (profile === "standard") return NextResponse.next();

    const forbidden = () => NextResponse.json(
      { ok: false, error: "FORBIDDEN" },
      { status: 403, headers: { "Cache-Control": "no-store" } }
    );

    if (!session.userId) return forbidden();

    // Consultazione degli incassi riservati: nessun'altra API disponibile.
    if (profile === "cash_readonly") {
      if (session.role !== "admin") return forbidden();
      if (req.method === "GET" && (
        pathname === "/api/reserved-cash/list" ||
        pathname === "/api/reserved-cash/detail" ||
        pathname === "/api/me"
      )) return NextResponse.next();
      return forbidden();
    }

    // Il profilo operatore puo' usare solo le API specifiche del riepilogo PV.
    // Un percorso non incluso viene bloccato: niente inventari, ordini o admin.
    if (profile === "cash_operator") {
      if (session.role !== "punto_vendita") return forbidden();
      const allowedCashPaths: Record<string, readonly string[]> = {
        "/api/me": ["GET"],
        "/api/cash-summary/pv-list": ["GET"],
        "/api/cash-summary/pv-get-by-id": ["GET"],
        "/api/cash-summary/pv-notifications": ["GET"],
        "/api/cash-summary/pv-notifications/read": ["POST"],
        "/api/cash-summary/save": ["POST"],
        "/api/cash-summary/fondo-cassa-iniziale/get": ["GET"],
        "/api/suppliers/search": ["GET"],
      };
      if (allowedCashPaths[pathname]?.includes(req.method)) return NextResponse.next();
      return forbidden();
    }
    return forbidden();
  }

  if (pathname === "/" || pathname === "/login" || pathname.startsWith("/login/")) {
    return NextResponse.next();
  }

  const cookie = req.cookies.get(COOKIE_NAME)?.value;
  const session = await parseSessionValueEdge(cookie);
  const redirect = (target: string) => {
    const url = req.nextUrl.clone();
    url.pathname = target;
    url.search = "";
    return NextResponse.redirect(url);
  };

  if (!session) return redirect("/login");

  const profile = session.accessProfile ?? "standard";

  if (profile === "cash_readonly") {
    if (session.role !== "admin" || !session.userId) return redirect("/login");
    // Accesso consentito esclusivamente alla futura area di sola lettura.
    if (pathname === "/reserved-cash" || pathname.startsWith("/reserved-cash/")) {
      return NextResponse.next();
    }
    return redirect("/reserved-cash");
  }

  if (profile === "cash_operator") {
    if (session.role !== "punto_vendita" || !session.userId) return redirect("/login");
    const cashPath = "/pv/riepilogo-incassato";
    if (pathname === cashPath || pathname.startsWith(cashPath + "/")) {
      return NextResponse.next();
    }
    return redirect(cashPath);
  }

  // Gli account standard non possono aprire l'area dedicata.
  if (pathname === "/reserved-cash" || pathname.startsWith("/reserved-cash/")) {
    return redirect(session.role === "admin" ? "/admin" :
      session.role === "punto_vendita" ? "/pv/inventario" : "/user");
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (session.role !== "admin") return redirect("/login");
    return NextResponse.next();
  }

  if (pathname === "/user" || pathname.startsWith("/user/")) {
    if (session.role === "punto_vendita") return redirect("/pv/inventario");
    if (session.role !== "admin" && session.role !== "amministrativo") return redirect("/login");
    return NextResponse.next();
  }

  if (pathname === "/pv" || pathname.startsWith("/pv/")) {
    if (session.role !== "admin" && session.role !== "punto_vendita") return redirect("/login");
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
