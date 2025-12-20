"use client";

import { useRouter } from "next/navigation";

export default function PuntoVenditaPage() {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <main className="p-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Punto Vendita</h1>
          <p className="text-gray-600 mt-1">
            Sezione dedicata al riscontro merce e all’inventario.
          </p>
        </div>

        <button
          onClick={logout}
          className="rounded-xl border px-4 py-2 hover:bg-gray-50"
        >
          Logout
        </button>
      </div>

      <div className="mt-8 rounded-2xl border p-6 bg-gray-50">
        <h2 className="text-lg font-medium mb-2">Inventario</h2>
        <p className="text-gray-700">
          Qui potrai:
        </p>
        <ul className="list-disc ml-6 mt-2 text-gray-700">
          <li>Effettuare il riscontro della merce in arrivo</li>
          <li>Gestire l’inventario del punto vendita</li>
          <li>Segnalare discrepanze o mancanze</li>
        </ul>

        <p className="text-sm text-gray-500 mt-4">
          Funzionalità in arrivo.
        </p>
      </div>
    </main>
  );
}
