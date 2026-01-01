import InventoryClient from "./InventoryClient";
import { requireRole } from "@/lib/auth";

export default async function InventoriesPage() {
  // accesso: SOLO admin, amministrativo
  await requireRole(["admin", "amministrativo"]);

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-4">
        <h1 className="text-2xl font-semibold">Inventario (Giacenze)</h1>
        <p className="text-gray-600">
          Seleziona Punto Vendita, Categoria e Data. Le quantità salvate vengono precompilate.
        </p>

        <InventoryClient />
      </div>
    </main>
  );
}

