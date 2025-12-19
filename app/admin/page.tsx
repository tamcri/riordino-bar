"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminPage() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
        body: JSON.stringify({ username, password }),
      });

      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error || "Errore");
        return;
      }

      setUsername("");
      setPassword("");
      setMsg("Utente creato con successo");
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

        <button
          onClick={logout}
          className="rounded-xl border px-4 py-2 hover:bg-gray-50"
        >
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

