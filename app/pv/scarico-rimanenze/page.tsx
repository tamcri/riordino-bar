// app/pv/scarico-rimanenze/page.tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import ScaricoRimanenzeClient from "./ScaricoRimanenzeClient";

export default function Page() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");

  // Solo PV
  if (session.role !== "punto_vendita") redirect("/user");

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Scarico Rimanenze</h1>
          <p className="text-gray-600 mt-1">Registra uno scarico e scala automaticamente le giacenze dal deposito PV-STOCK.</p>
        </div>

        <ScaricoRimanenzeClient />
      </div>
    </main>
  );
}
