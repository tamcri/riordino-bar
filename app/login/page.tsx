"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // bootstrap admin al primo avvio (solo dev o prima installazione)
    fetch("/api/auth/bootstrap", { method: "POST" }).catch(() => {});
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const json = await res.json();

      if (!json.ok) {
        setMsg(json.error || "Errore login");
        return;
      }

      // ✅ redirect deciso dal backend in base al ruolo:
      // admin -> /admin, amministrativo -> /user, punto_vendita -> /pv
      const to = json.redirectTo || (json.role === "admin" ? "/admin" : "/user");
      router.replace(to);
    } catch (err: any) {
      setMsg(err?.message || "Errore login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Accesso</h1>
        <p className="text-sm text-gray-500 mt-1">Riordino Bar/Tabacchi</p>

        <form className="mt-6 space-y-3" onSubmit={onSubmit}>
          <input
            className="w-full rounded-xl border p-3"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
          />
          <input
            className="w-full rounded-xl border p-3"
            placeholder="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />

          <button
            className="w-full rounded-xl bg-black text-white p-3 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Accesso..." : "Entra"}
          </button>

          {msg && <p className="text-sm text-red-600">{msg}</p>}
        </form>
      </div>
    </main>
  );
}

