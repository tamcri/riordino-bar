import Link from "next/link";
import WarehouseItemsClient from "./WarehouseItemsClient";

export const dynamic = "force-dynamic";

export default function WarehouseItemsPage() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-[1400px] px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Anagrafica Magazzino</h1>
          <p className="mt-1 text-sm text-gray-600">
            Gestione articoli del magazzino centrale, separata dall&apos;anagrafica articoli generale.
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

        <WarehouseItemsClient />
      </div>
    </main>
  );
}