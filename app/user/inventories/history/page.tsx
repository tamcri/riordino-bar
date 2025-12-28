import { cookies } from "next/headers";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import InventoryHistoryClient from "./InventoryHistoryClient";

export default function Page() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    return (
      <main className="min-h-screen bg-gray-100">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <div className="rounded-2xl border bg-white p-6">
            <h1 className="text-xl font-semibold">Storico Inventari</h1>
            <p className="text-gray-600 mt-2">Non autorizzato.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Storico Inventari</h1>
          <p className="text-gray-600 mt-1">
            Filtra per Punto Vendita (opzionale) e Categoria. Se PV è vuoto, vedi tutti i PV per quella categoria.
          </p>
        </div>

        <InventoryHistoryClient />
      </div>
    </main>
  );
}
