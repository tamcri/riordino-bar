import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import CashSummaryAdminClient from "./CashSummaryAdminClient";
import { resolvePvAccess } from "@/lib/pvAccess";

export default async function AdminCashSummaryPage() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");
  if (!["admin", "amministrativo"].includes(session.role)) redirect("/login");

  // Non mostrare il cruscotto con azioni amministrative a profili di sola lettura.
  // La pagina dedicata sara introdotta in uno step separato.
  const access = await resolvePvAccess(session);
  if (access.profile !== "standard") redirect("/login");

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Riepiloghi Incassato</h1>
          <p className="text-slate-600 mt-1">
            Controllo giornaliero per PV con progressivo Da Versare e variazione Fondo Cassa.
          </p>
        </div>

        <Link
          href="/admin"
          className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
        >
          Torna ad Admin
        </Link>
      </div>

      <CashSummaryAdminClient />
    </div>
  );
}