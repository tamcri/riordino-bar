import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url || !serviceKey) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

// ✅ Debug leggero: mostra quale progetto Supabase stai usando (solo host, niente chiavi)
const supaHost = (() => {
  try {
    return new URL(url).host;
  } catch {
    return "INVALID_SUPABASE_URL";
  }
})();

// Nota: in dev è utilissimo. In prod non stampa nulla.
if (process.env.NODE_ENV !== "production") {
  // eslint-disable-next-line no-console
  console.log(`[supabaseAdmin] SUPABASE_URL host = ${supaHost}`);
}

export const supabaseAdmin = createClient(url, serviceKey, {
  auth: { persistSession: false },
});

