// app/pv/layout.tsx
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { parseSessionValue, COOKIE_NAME } from "@/lib/auth";
import UserTopBarClient from "../../components/UserTopBarClient";

export default function PvLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  const session = parseSessionValue(raw);

  if (!session) redirect("/login");

  const username = session.username ?? "Utente";
  const role = session.role ?? null;

  if (role !== "punto_vendita") {
    redirect(role === "admin" ? "/admin" : "/user");
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-emerald-600 flex items-center justify-center font-bold">
              PV
            </div>
            <div>
              <div className="text-lg font-semibold tracking-wide">3M CONTROL</div>
              <div className="text-xs text-slate-200">Area Punto Vendita</div>
            </div>
          </div>

          <UserTopBarClient username={username} />
        </div>
      </header>

      <nav className="bg-white border-b">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-3 flex-wrap">
          <Link
            href="/pv/inventario"
            className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700"
          >
            Inventario PV
          </Link>

          <Link
            href="/pv/inventario/history"
            className="inline-flex items-center rounded-xl px-4 py-2 text-sm font-medium bg-emerald-700 text-white hover:bg-emerald-800"
          >
            Storico Inventari
          </Link>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-6">{children}</main>
    </div>
  );
}

