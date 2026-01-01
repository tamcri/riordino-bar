import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

// Riutilizziamo lo stesso client dello storico "user"
import InventoryHistoryClient from "@/app/user/inventories/history/InventoryHistoryClient";

export default function PvInventarioHistoryPage() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");

  // Questa route è per Punto Vendita.
  // Admin e amministrativo usano lo storico in /user.
  if (session.role !== "punto_vendita") {
    redirect("/user/inventories/history");
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Storico Inventari</h1>
          <p className="text-gray-600 mt-1">
            Qui vedi solo lo storico inventari del tuo Punto Vendita.
          </p>
        </div>

        <InventoryHistoryClient />
      </div>
    </main>
  );
}
