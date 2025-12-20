"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type CreateRole = "amministrativo" | "punto_vendita";

export default function AdminPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CreateRole>("amministrativo"); // ✅ default sensato

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, role }), // ✅ invio ruolo
      });

      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error || "Errore");
        return;
      }

      setUsername("");
      setPassword("");
      setMsg(`Utente creato con successo (${role === "amministrativo" ? "Amministrativo" : "Punto Vendita"})`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="p-6 max-w-md">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Admin</h1>
          <p className="text-gray-600 mt-1">Crea nuovo utente</p>
        </div>

        <button onClick={logout} className="rounded-xl border px-4 py-2 hover:bg-gray-50">
          Logout
        </button>
      </div>

      <form onSubmit={createUser} className="mt-6 space-y-3">
        <input
          className="w-full rounded-xl border p-3"
          placeholder="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />

        <input
          className="w-full rounded-xl border p-3"
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {/* ✅ dropdown ruolo */}
        <div>
          <label className="block text-sm font-medium mb-2">Ruolo</label>
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={role}
            onChange={(e) => setRole(e.target.value as CreateRole)}
          >
            <option value="amministrativo">Amministrativo</option>
            <option value="punto_vendita">Punto Vendita</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Amministrativo: riordino e funzioni ufficio. Punto Vendita: riscontro/inventario.
          </p>
        </div>

        <button
          className="w-full rounded-xl bg-black text-white p-3 disabled:opacity-60"
          disabled={loading}
        >
          {loading ? "Creazione..." : "Crea utente"}
        </button>

        {msg && <p className="text-sm">{msg}</p>}
      </form>
    </main>
  );
}


