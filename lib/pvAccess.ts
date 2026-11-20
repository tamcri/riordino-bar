// lib/pvAccess.ts
// Centralizza i permessi dei PV. Da usare SOLO sul server.
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { SessionData } from "@/lib/auth";

export type PvAction = "read" | "write" | "full";
export type AccessProfile = "standard" | "cash_readonly" | "cash_operator";
export type PvVisibilityRow = { id: string; is_reserved: boolean };
export type PvAccessContext = {
  userId: string;
  username: string;
  role: SessionData["role"];
  profile: AccessProfile;
  assignedPvId: string | null;
  isPrimaryAdmin: boolean;
  permissions: Map<string, PvAction>;
};

// L'identita' e' verificata tramite UUID e username, non soltanto tramite il ruolo admin.
const PRIMARY_ADMIN_ID = "56182fe5-a320-47c9-9dff-47044124dd2c";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeProfile(value: unknown): AccessProfile {
  if (value === "cash_readonly" || value === "cash_operator") return value;
  if (value === "standard") return value;
  // Fail closed: profili inattesi non ottengono accesso standard.
  throw new Error("Profilo di accesso non riconosciuto");
}

export async function resolvePvAccess(session: SessionData): Promise<PvAccessContext> {
  if (!session?.username) throw new Error("UNAUTHORIZED");

  const { data: user, error: userError } = await supabaseAdmin
    .from("app_users")
    .select("id, username, role, pv_id, access_profile")
    .eq("username", session.username)
    .maybeSingle();

  if (userError) throw userError;
  if (!user || !UUID.test(String(user.id))) throw new Error("UNAUTHORIZED");
  if (user.role !== session.role) throw new Error("UNAUTHORIZED");
  if (session.userId && session.userId !== user.id) throw new Error("UNAUTHORIZED");

  const profile = normalizeProfile(user.access_profile);
  const userId = String(user.id);
  // Per l'Admin principale e' obbligatoria una sessione nuova con userId verificato.
  const isPrimaryAdmin = userId === PRIMARY_ADMIN_ID &&
    session.userId === PRIMARY_ADMIN_ID &&
    user.username === "admin" && user.role === "admin" && profile === "standard";

  const { data: grants, error: grantsError } = await supabaseAdmin
    .from("pv_access_permissions")
    .select("pv_id, permission")
    .eq("user_id", userId);
  if (grantsError) throw grantsError;

  const permissions = new Map<string, PvAction>();
  for (const grant of grants ?? []) {
    if (grant.permission === "read" || grant.permission === "write" || grant.permission === "full") {
      permissions.set(String(grant.pv_id), grant.permission);
    }
  }

  return {
    userId,
    username: String(user.username),
    role: session.role,
    profile,
    assignedPvId: user.pv_id ? String(user.pv_id) : null,
    isPrimaryAdmin,
    permissions,
  };
}

export function canAccessPv(
  context: PvAccessContext,
  pv: PvVisibilityRow,
  action: PvAction = "read"
): boolean {
  if (!pv?.id) return false;
  if (context.isPrimaryAdmin) return true;

  if (context.profile === "standard") {
    if (pv.is_reserved) return false;
    if (context.role === "admin" || context.role === "amministrativo") return true;
    // Il PV standard deve accedere solo al punto vendita assegnato.
    return context.role === "punto_vendita" && context.assignedPvId === pv.id;
  }

  // I profili limitati non possono mai accedere ai PV ordinari o ad altri PV.
  if (!pv.is_reserved || context.assignedPvId !== pv.id) return false;
  if (context.profile === "cash_operator" && context.role !== "punto_vendita") return false;
  if (context.profile === "cash_readonly" && context.role !== "admin") return false;

  const permission = context.permissions.get(pv.id);
  if (context.profile === "cash_readonly") {
    return action === "read" && (permission === "read" || permission === "full");
  }
  if (context.profile === "cash_operator") {
    return action === "read"
      ? permission === "read" || permission === "write" || permission === "full"
      : action === "write" && (permission === "write" || permission === "full");
  }
  return false;
}

export async function requirePvAccess(
  context: PvAccessContext,
  pvId: string,
  action: PvAction = "read"
): Promise<void> {
  if (!UUID.test(pvId)) throw new Error("FORBIDDEN");
  const { data: pv, error } = await supabaseAdmin
    .from("pvs")
    .select("id, is_reserved")
    .eq("id", pvId)
    .maybeSingle();
  if (error) throw error;
  if (!pv || !canAccessPv(context, pv, action)) throw new Error("FORBIDDEN");
}

export function filterVisiblePvs<T extends PvVisibilityRow>(
  context: PvAccessContext,
  pvs: T[]
): T[] {
  return pvs.filter((pv) => canAccessPv(context, pv, "read"));
}

export function isCashOnlyProfile(context: PvAccessContext): boolean {
  return context.profile === "cash_operator" || context.profile === "cash_readonly";
}
