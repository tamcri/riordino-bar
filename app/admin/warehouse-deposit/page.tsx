import Link from "next/link";
import WarehouseDepositClient from "./WarehouseDepositClient";

export const dynamic = "force-dynamic";

export default function WarehouseDepositPage() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Deposito Centrale</h1>
          <p className="mt-1 text-sm text-gray-600">
            Gestione articoli presenti nel deposito del magazzino centrale.
          </p>
        </div>
        <div className="mb-4">
       <Link
        href="/admin"
      className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
       >
       ← Torna ad Admin
       </Link>
      </div>

        <WarehouseDepositClient />
      </div>
    </main>
  );
}