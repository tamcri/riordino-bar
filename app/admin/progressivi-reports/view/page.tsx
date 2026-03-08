import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import ProgressiviReportTable from "@/components/reports/ProgressiviReportTable";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { getProgressiviReportData } from "@/lib/progressivi/report";

export const runtime = "nodejs";

type Props = {
  searchParams?: Record<string, string | string[] | undefined>;
};

function pick(v: string | string[] | undefined) {
  return Array.isArray(v) ? v[0] : v;
}

export default async function ProgressiviReportViewPage({ searchParams }: Props) {
  const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
  if (!session || !["admin", "amministrativo"].includes(session.role)) {
    redirect("/");
  }

  const sp = searchParams ?? {};

  try {
    const data = await getProgressiviReportData({
      header_id: pick(sp.header_id),
      pv_id: pick(sp.pv_id),
      inventory_date: pick(sp.inventory_date),
      category_id: pick(sp.category_id),
      subcategory_id: pick(sp.subcategory_id),
    });

    const qs = new URLSearchParams();
    if (data.current_header.id) qs.set("header_id", data.current_header.id);

    return (
      <div className="p-6">
        <ProgressiviReportTable data={data} downloadHref={`/api/inventories/progressivi/report?${qs.toString()}`} />
      </div>
    );
  } catch (e: any) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          {e?.message || "Errore generazione report progressivi"}
        </div>
      </div>
    );
  }
}
