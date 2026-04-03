import Link from "next/link";
import WarehouseInventoryHistoryClient from "./WarehouseInventoryHistoryClient";

export const dynamic = "force-dynamic";

export default function WarehouseInventoryHistoryPage() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Storico Inventari Magazzino</h1>
          <p className="mt-1 text-sm text-gray-600">
            Elenco inventari confermati del deposito centrale.
          </p>
        </div>

        <div className="mb-4 flex gap-2">
          <Link
            href="/admin/warehouse-inventory"
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← Torna a Inventario Magazzino
          </Link>

          <Link
            href="/admin"
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← Torna ad Admin
          </Link>
        </div>

        <WarehouseInventoryHistoryClient />
      </div>
    </main>
  );
}