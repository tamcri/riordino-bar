import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseSessionValue, COOKIE_NAME } from "@/lib/auth";
import UserTopBarClient from "../../components/UserTopBarClient";

export default function UserLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  const session = parseSessionValue(raw);

  // se non loggato, fuori
  if (!session) redirect("/login");

  const username = session.username ?? "Utente";
  const role = session.role ?? null;

  // ✅ PV non deve stare in /user
  if (role === "punto_vendita") {
    redirect("/pv");
  }

  const isAdmin = role === "admin";
  const isAmministrativo = role === "amministrativo";

  const showAdminArea = isAdmin || isAmministrativo;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Top bar */}
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-orange-500 flex items-center justify-center font-bold">
              3M
            </div>
            <div>
              <div className="text-lg font-semibold tracking-wide">3M CONTROL</div>
              <div className="text-xs text-slate-200">Area Amministrativa</div>
            </div>
          </div>

          <UserTopBarClient username={username} />
        </div>
      </header>

      {/* Menu */}
      <nav className="bg-white border-b">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-3 flex-wrap">
          {isAdmin && (
            <Link
              href="/admin"
              className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-slate-900 text-white hover:bg-slate-800"
            >
              Admin
            </Link>
          )}

          {showAdminArea && (
            <>
              <Link
                href="/user/order-tab"
                className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
              >
                Order Tab
              </Link>

              <Link
                href="/user/order-gv"
                className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-orange-500 text-white hover:bg-orange-600"
              >
                Order G&amp;V
              </Link>

              <Link
                href="/user/history"
                className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-slate-700 text-white hover:bg-slate-800"
              >
                Storico Ordini
              </Link>

              <Link
                href="/user/items"
                className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-slate-700 text-white hover:bg-slate-800"
              >
                Articoli
              </Link>

              <Link
                href="/user/inventories"
                className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700"
              >
                Inventario
              </Link>

              <Link
                href="/user/inventories/history"
                className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800"
              >
                Storico Inventari
              </Link>
            </>
          )}
        </div>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}




