import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import CashSummaryAdminDetailClient from "./CashSummaryAdminDetailClient";

export default function AdminCashSummaryDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");
  if (!["admin", "amministrativo"].includes(session.role)) redirect("/login");

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Dettaglio Riepilogo Incassato
          </h1>
          <p className="text-slate-600 mt-1">
            Visualizzazione completa del movimento selezionato.
          </p>
        </div>

        <Link
          href="/admin/cash-summary"
          className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
        >
          Torna ai Riepiloghi
        </Link>
      </div>

      <CashSummaryAdminDetailClient id={params.id} />
    </div>
  );
}