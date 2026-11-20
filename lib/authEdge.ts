export const COOKIE_NAME = "rb_session";

type SessionRole = "admin" | "amministrativo" | "punto_vendita";
type SessionProfile = "standard" | "cash_readonly" | "cash_operator";

export type SessionData = {
  username: string;
  role: SessionRole;
  /** Identificativo DB; assente nelle sessioni create prima dell aggiornamento del login. */
  userId?: string;
  accessProfile?: SessionProfile;
  iat: number;
};

// ---- helpers base64url ----
function base64UrlToUint8Array(b64url: string) {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function timingSafeEqualHex(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacSha256Hex(payloadB64: string, secret: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const bytes = new Uint8Array(sig);
  // hex
  let hex = "";
  for (const x of bytes) hex += x.toString(16).padStart(2, "0");
  return hex;
}

export async function parseSessionValueEdge(value?: string | null): Promise<SessionData | null> {
  if (!value) return null;
  const [b64, sig] = value.split(".");
  if (!b64 || !sig) return null;

  const secret = process.env.SESSION_SECRET;
  if (!secret) return null;

  const expected = await hmacSha256Hex(b64, secret);
  if (!timingSafeEqualHex(sig, expected)) return null;

  try {
    const jsonBytes = base64UrlToUint8Array(b64);
    const json = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(json) as SessionData;

    if (!parsed?.username) return null;
    if (!["admin", "amministrativo", "punto_vendita"].includes(parsed.role)) return null;

    if (parsed.accessProfile !== undefined &&
        !["standard", "cash_readonly", "cash_operator"].includes(parsed.accessProfile)) return null;
    if (parsed.accessProfile && parsed.accessProfile !== "standard" && !parsed.userId) return null;
    if (parsed.accessProfile === "cash_readonly" && parsed.role !== "admin") return null;
    if (parsed.accessProfile === "cash_operator" && parsed.role !== "punto_vendita") return null;

    // Compatibilita con le sessioni esistenti: userId e ancora opzionale.
    // Se presente, deve essere un UUID valido.
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
