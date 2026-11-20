import { cookies } from "next/headers";
import crypto from "crypto";

export const COOKIE_NAME = "rb_session";

export type SessionRole = "admin" | "amministrativo" | "punto_vendita";
export type SessionProfile = "standard" | "cash_readonly" | "cash_operator";

export type SessionData = {
  username: string;
  role: SessionRole;
  /** ID della riga app_users; opzionale per le vecchie sessioni. */
  userId?: string;
  /** Profilo verificato al login e incluso nella firma del cookie. */
  accessProfile?: SessionProfile;
  iat: number;
};

function sign(payload: string) {
  const secret = process.env.SESSION_SECRET!;
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function makeSessionValue(session: Omit<SessionData, "iat">) {
  const data: SessionData = { ...session, iat: Date.now() };
  const json = JSON.stringify(data);
  const b64 = Buffer.from(json).toString("base64url");
  const sig = sign(b64);
  return `${b64}.${sig}`;
}

export function parseSessionValue(value?: string | null): SessionData | null {
  if (!value) return null;
  const [b64, sig] = value.split(".");
  if (!b64 || !sig) return null;

  const expected = sign(b64);
  if (sig !== expected) return null;

  try {
    const json = Buffer.from(b64, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as SessionData;

    // ✅ hardening: evita ruoli "sporchi" da cookie vecchi o manomessi
    if (!parsed?.username) return null;
    if (!["admin", "amministrativo", "punto_vendita"].includes(parsed.role)) return null;

    if (parsed.accessProfile !== undefined &&
        !["standard", "cash_readonly", "cash_operator"].includes(parsed.accessProfile)) return null;
    // I nuovi profili devono avere una sessione associata a un utente DB.
    if (parsed.accessProfile && parsed.accessProfile !== "standard" && !parsed.userId) return null;
    if (parsed.accessProfile === "cash_readonly" && parsed.role !== "admin") return null;
    if (parsed.accessProfile === "cash_operator" && parsed.role !== "punto_vendita") return null;

    // Accetta i cookie precedenti, che non avevano userId.
    // Se presente, userId deve corrispondere al formato UUID.
    if (parsed.userId !== undefined) {
      if (
        typeof parsed.userId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.userId)
      ) {
        return null;
      }
    }

    return parsed;
  } catch {
    return null;
  }
}

export async function getSession(): Promise<SessionData | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value ?? null;
  return parseSessionValue(raw);
}

export async function requireSession(): Promise<SessionData> {
  const session = await getSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

export async function requireRole(allowed: SessionRole[]): Promise<SessionData> {
  const session = await requireSession();
  if (!allowed.includes(session.role)) throw new Error("FORBIDDEN");
  return session;
}

