import Link from "next/link";
import { cookies } from "next/headers";
import { parseSessionValue, COOKIE_NAME } from "@/lib/auth";
import UserTopBarClient from "../../components/UserTopBarClient";

export default function UserLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  const session = parseSessionValue(raw);

  // (Il middleware già protegge /user, ma teniamo un fallback)
  const username = session?.username ?? "Utente";

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
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-3">
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
           Order G&V
            </Link>
            
          {/* Qui aggiungeremo altre voci man mano */}
          {/* <Link href="/user/qualcosa" className="...">Nuova funzione</Link> */}
        </div>
      </nav>

      {/* Content */}
      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}
