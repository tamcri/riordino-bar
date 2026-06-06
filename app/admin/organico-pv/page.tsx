import { requireRole } from "@/lib/auth";
import OrganicoPvClient from "./OrganicoPvClient";

export const dynamic = "force-dynamic";

export default async function OrganicoPvPage() {
  await requireRole(["admin"]);
  return <OrganicoPvClient />;
}
