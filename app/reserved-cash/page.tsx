import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { resolvePvAccess, requirePvAccess } from "@/lib/pvAccess";
import ReservedCashClient from "./ReservedCashClient";

export const dynamic = "force-dynamic";

export default async function ReservedCashPage() {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session) redirect("/login");
  try {
    const context = await resolvePvAccess(session);
    if (context.profile !== "cash_readonly" || context.role !== "admin" || !context.assignedPvId || !session.userId) {
      redirect("/login");
    }
    await requirePvAccess(context, context.assignedPvId, "read");
  } catch (error) {
    // In Next.js redirect() lancia un'eccezione speciale, che non va intercettata.
    if (error && typeof error === "object" && "digest" in error && String(error.digest).startsWith("NEXT_REDIRECT")) throw error;
    redirect("/login");
  }
  return <ReservedCashClient />;
}
