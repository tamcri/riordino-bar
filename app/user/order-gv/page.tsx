import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import OrderGVClient from "./OrderGVClient";

export default async function Page() {
  const session = await getSession();
  if (!session) redirect("/login");

  // ✅ PV NON deve entrare qui
  if (session.role === "punto_vendita") {
    redirect("/user/inventories-pv");
  }

  // ✅ Qui entrano admin + amministrativo
  return <OrderGVClient />;
}





