import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import HistoryClient from "./HistoryClient";


export default async function HistoryPage() {
  const cookieStore = cookies();

  const raw = cookieStore.get(COOKIE_NAME)?.value ?? null;
  const session = parseSessionValue(raw);

  // Non loggato → login
  if (!session) redirect("/login");

  // Ruolo non ammesso → fuori (puoi anche redirect("/user") se preferisci)
  if (!["admin", "amministrativo"].includes(session.role)) redirect("/user");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Storico Riordini</h1>
        <p className="text-slate-600 mt-1">
          Qui trovi tutti i riordini salvati (TAB e G&amp;V) e puoi riscaricare l’Excel.
        </p>
      </div>

      <HistoryClient />
    </div>
  );
}
