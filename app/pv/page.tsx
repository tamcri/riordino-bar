import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";

export default function PvHomePage() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

  if (!session) redirect("/login");

  // ✅ PV va SEMPRE all’inventario
  if (session.role === "punto_vendita") {
    redirect("/pv/inventario");
  }

  // ✅ admin/amministrativo non devono stare qui
  redirect("/user");
}



