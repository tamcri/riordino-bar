import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function getAppUserIdByUsername(username: string | null | undefined) {
  const clean = String(username ?? "").trim();
  if (!clean) return null;

  const { data, error } = await supabaseAdmin
    .from("app_users")
    .select("id")
    .eq("username", clean)
    .maybeSingle();

  if (error || !data?.id) return null;
  return String(data.id);
}
