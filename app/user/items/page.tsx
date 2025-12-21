import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import ItemsClient from "./ItemsClient";

export default function ItemsPage() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session) redirect("/login");
  if (!["admin", "amministrativo"].includes(session.role)) redirect("/login");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Anagrafica Articoli</h1>
        <p className="text-slate-600 mt-1">
          Import da Excel (pulito o gestionale) + modifica manuale. Inserimento/modifica solo admin.
        </p>
      </div>

      <ItemsClient isAdmin={session.role === "admin"} />
    </div>
  );
}
