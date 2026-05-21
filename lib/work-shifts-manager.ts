import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { COOKIE_NAME, parseSessionValue, type SessionData } from "@/lib/auth";
import { getPvIdForSession } from "@/lib/pvLookup";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const SHIFT_MANAGER_COOKIE_NAME = "rb_shift_manager";
export const SHIFT_MANAGER_MAX_AGE_SECONDS = 8 * 60 * 60;

type ShiftManagerCookieData = {
  username: string;
  pv_id: string;
  iat: number;
  exp: number;
};

export type ShiftManagerStatus = {
  ok: boolean;
  pv_id: string | null;
  configured: boolean;
  enabled: boolean;
  unlocked: boolean;
  error?: string;
};

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET!;
  return crypto.createHmac("sha256", secret).update(`shift-manager.${payload}`).digest("hex");
}

export function validateManagerCode(value: unknown) {
  const code = String(value ?? "").trim();
  if (!/^[A-Za-z0-9]{6,32}$/.test(code)) {
    return {
      ok: false as const,
      code,
      error: "Il codice responsabile deve essere alfanumerico, senza spazi, da 6 a 32 caratteri.",
    };
  }

  return { ok: true as const, code };
}

export async function hashManagerCode(code: string) {
  return bcrypt.hash(code, 12);
}

export async function compareManagerCode(code: string, hash: string) {
  return bcrypt.compare(code, hash);
}

export function makeShiftManagerCookieValue(args: { username: string; pv_id: string }) {
  const now = Date.now();
  const data: ShiftManagerCookieData = {
    username: args.username,
    pv_id: args.pv_id,
    iat: now,
    exp: now + SHIFT_MANAGER_MAX_AGE_SECONDS * 1000,
  };

  const b64 = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

export function parseShiftManagerCookieValue(value?: string | null): ShiftManagerCookieData | null {
  if (!value) return null;

  const [b64, sig] = value.split(".");
  if (!b64 || !sig) return null;
  if (sign(b64) !== sig) return null;

  try {
    const parsed = JSON.parse(Buffer.from(b64, "base64url").toString("utf8")) as ShiftManagerCookieData;
    if (!parsed?.username || !parsed?.pv_id || !parsed?.exp) return null;
    if (Date.now() > Number(parsed.exp)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function shiftManagerCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function getCurrentSessionFromCookie() {
  return parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
}

async function getShiftSetting(pvId: string) {
  const { data, error } = await supabaseAdmin
    .from("pv_shift_settings")
    .select("pv_id, pin_hash, enabled")
    .eq("pv_id", pvId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data as { pv_id: string; pin_hash: string | null; enabled: boolean } | null;
}

export async function getShiftManagerStatusForSession(session: SessionData): Promise<ShiftManagerStatus> {
  if (session.role !== "punto_vendita") {
    return {
      ok: false,
      pv_id: null,
      configured: false,
      enabled: false,
      unlocked: false,
      error: "Funzione riservata ai punti vendita.",
    };
  }

  const pvLookup = await getPvIdForSession(session);
  const pv_id = pvLookup.pv_id;
  if (!pv_id) {
    return {
      ok: false,
      pv_id: null,
      configured: false,
      enabled: false,
      unlocked: false,
      error: "Utente PV senza pv_id assegnato.",
    };
  }

  const setting = await getShiftSetting(pv_id);
  const configured = Boolean(setting?.pin_hash);
  const enabled = setting?.enabled !== false;

  const rawCookie = cookies().get(SHIFT_MANAGER_COOKIE_NAME)?.value ?? null;
  const managerSession = parseShiftManagerCookieValue(rawCookie);
  const unlocked = Boolean(
    configured &&
      enabled &&
      managerSession &&
      managerSession.username === session.username &&
      managerSession.pv_id === pv_id
  );

  return {
    ok: true,
    pv_id,
    configured,
    enabled,
    unlocked,
    error: !configured
      ? "Codice responsabile non configurato. Contatta l'amministratore."
      : !enabled
        ? "Accesso turni momentaneamente bloccato. Contatta l'amministratore."
        : !unlocked
          ? "Accesso responsabile richiesto."
          : undefined,
  };
}

export async function requireShiftManagerAccess(session: SessionData) {
  const status = await getShiftManagerStatusForSession(session);

  if (!status.ok) {
    return { ok: false as const, status, httpStatus: 401, error: status.error ?? "Non autorizzato" };
  }

  if (!status.configured) {
    return { ok: false as const, status, httpStatus: 403, error: status.error ?? "Codice responsabile non configurato" };
  }

  if (!status.enabled) {
    return { ok: false as const, status, httpStatus: 403, error: status.error ?? "Accesso turni bloccato" };
  }

  if (!status.unlocked) {
    return { ok: false as const, status, httpStatus: 403, error: status.error ?? "Accesso responsabile richiesto" };
  }

  return { ok: true as const, status, pv_id: status.pv_id as string };
}
