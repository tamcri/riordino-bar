import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import SupplierDownloadsClient from "./SupplierDownloadsClient";

export default function AdminSupplierDownloadsPage() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");
  if (!["admin", "amministrativo"].includes(session.role)) redirect("/login");

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Scarichi Fornitori
          </h1>
          <p className="mt-1 text-slate-600">
            Analisi degli scarichi fornitori registrati nei riepiloghi incassato
            dei punti vendita.
          </p>
        </div>

        <Link
          href="/admin/cash-summary"
          className="inline-flex w-fit items-center justify-center rounded-xl border bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-gray-50"
        >
          Torna ai Riepiloghi
        </Link>
      </div>

      <SupplierDownloadsClient />
    </div>
  );
}