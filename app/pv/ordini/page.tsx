import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import OrdiniClient from "./OrdiniClient";

export default function Page() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");

  if (session.role !== "punto_vendita") redirect("/user");

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Ordini</h1>
          <p className="text-gray-600 mt-1">
            Crea un nuovo ordine PV da inviare all&apos;amministrazione.
          </p>
        </div>

        <OrdiniClient />
      </div>
    </main>
  );
}