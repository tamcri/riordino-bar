import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { resolvePvAccess } from "@/lib/pvAccess";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session || session.role !== "admin") {
    redirect("/login");
  }

  // Controllo server-side: il ruolo admin da solo non autorizza
  // l'accesso a tutte le pagine amministrative.
  let access;
  try {
    access = await resolvePvAccess(session);
  } catch {
    redirect("/login");
  }

  if (access.profile !== "standard") {
    // La pagina dedicata al responsabile read-only verra' aggiunta
    // separatamente, fuori dall'area amministrativa completa.
    redirect("/login");
  }

  return <>{children}</>;
}
