import crypto from "crypto";

export const COOKIE_NAME = "rb_session";

export type SessionRole = "admin" | "amministrativo" | "punto_vendita";

export type SessionData = {
  username: string;
  role: SessionRole;
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

    return parsed;
  } catch {
    return null;
  }
}


