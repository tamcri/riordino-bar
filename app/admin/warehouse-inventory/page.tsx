import Link from "next/link";
import WarehouseInventoryClient from "./WarehouseInventoryClient";

export default function WarehouseInventoryPage() {
  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Inventario Magazzino</h1>
          <p className="mt-1 text-sm text-gray-600">
            Inserimento inventario del deposito centrale con verifica prima della conferma finale.
          </p>
        </div>

        <div className="mb-4 flex gap-2">
          <Link
            href="/admin"
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            ← Torna ad Admin
          </Link>

          <Link
            href="/admin/warehouse-inventory/history"
            className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          >
            Storico Inventari Magazzino
          </Link>
        </div>

        <WarehouseInventoryClient />
      </div>
    </main>
  );
}