import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import TurniPvClient from "./TurniPvClient";

export default function Page() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");
  if (session.role !== "punto_vendita") redirect("/user");

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Turni</h1>
          <p className="text-gray-600 mt-1">
            Inserisci e aggiorna i turni settimanali del tuo punto vendita.
          </p>
        </div>

        <TurniPvClient />
      </div>
    </main>
  );
}
