import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SessionData } from "@/lib/auth";

const USER_TABLE_CANDIDATES = ["app_user", "app_users", "utenti", "users"] as const;

function guessPvCodeFromUsername(username: string): string | null {
  const code = (username || "").trim().split(/\s+/)[0]?.toUpperCase();
  if (!code || code.length > 5) return null;
  return code;
}

export async function getPvIdForSession(session: SessionData): Promise<{ pv_id: string | null; warning?: string }> {
  if (!session) return { pv_id: null };
  if (session.role === "admin" || session.role === "amministrativo") return { pv_id: null };

  const username = session.username;

  // 1) Provo dalla tabella utenti
  for (const table of USER_TABLE_CANDIDATES) {
    const { data, error } = await supabaseAdmin.from(table).select("pv_id").eq("username", username).maybeSingle();
    if (error) continue;
    const pv_id = (data as any)?.pv_id ?? null;
    if (pv_id) return { pv_id: String(pv_id) };
  }

  // 2) Fallback: deduco dal codice PV nello username (es. "A1 DIVERSIVO" -> "A1")
  const code = guessPvCodeFromUsername(username);
  if (code) {
    const { data, error } = await supabaseAdmin
      .from("pvs")
      .select("id, code")
      .eq("is_active", true)
      .eq("code", code)
      .maybeSingle();

    if (!error && data?.id) {
      return {
        pv_id: String(data.id),
        warning: `pv_id non presente in tabella utenti; dedotto da username (${code}). Consigliato assegnare pv_id correttamente all’utente.`,
      };
    }
  }

  return { pv_id: null };
}
