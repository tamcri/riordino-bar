"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type CreateRole = "amministrativo" | "punto_vendita";

export default function AdminPage() {
  const router = useRouter();

  // --- crea utente ---
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CreateRole>("amministrativo");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // --- crea PV ---
  const [pvCode, setPvCode] = useState("");
  const [pvName, setPvName] = useState("");
  const [pvMsg, setPvMsg] = useState<string | null>(null);
  const [pvLoading, setPvLoading] = useState(false);

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
        body: JSON.stringify({ username, password, role }),
      });

      const json = await res.json();
      if (!json.ok) {
        setMsg(json.error || "Errore");
        return;
      }

      setUsername("");
      setPassword("");
      setMsg(
        `Utente creato con successo (${
          role === "amministrativo" ? "Amministrativo" : "Punto Vendita"
        })`
      );
    } finally {
      setLoading(false);
    }
  }

  async function createPV(e: React.FormEvent) {
    e.preventDefault();
    setPvMsg(null);
    setPvLoading(true);

    try {
      const res = await fetch("/api/pvs/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: pvCode, name: pvName }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setPvMsg(json?.error || "Errore");
        return;
      }

      setPvCode("");
      setPvName("");
      setPvMsg(`PV creato: ${json.pv.code} - ${json.pv.name}`);
    } finally {
      setPvLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
        {/* header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Admin</h1>
            <p className="text-gray-600 mt-1">Gestione utenti e punti vendita</p>
          </div>

          <button onClick={logout} className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50">
            Logout
          </button>
        </div>

        {/* layout a griglia */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* colonna sinistra */}
          <section className="rounded-2xl border bg-white p-4 lg:col-span-1">
            <h2 className="text-lg font-semibold">Area Operativa</h2>
            <p className="text-sm text-gray-600 mt-1">
              Link rapidi alle funzioni operative (resti admin, non perdi nulla).
            </p>

            <div className="mt-4 grid grid-cols-1 gap-2">
              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/user/order-tab">
                Order Tab
              </Link>

              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/user/order-gv">
                Order G&amp;V
              </Link>

              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/user/history">
                Storico Ordini
              </Link>

              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/user/items">
                Anagrafica Articoli
              </Link>

              <div className="pt-3 border-t mt-2">
                <p className="text-xs text-gray-500">
                  Tip: nel menu dell’area operativa aggiungeremo anche il tasto “Admin” per tornare qui.
                </p>
              </div>
            </div>
          </section>

          {/* colonna destra: forms */}
          <div className="lg:col-span-2 space-y-6">
            {/* crea utente */}
            <section className="rounded-2xl border bg-white p-4">
              <h2 className="text-lg font-semibold">Crea nuovo utente</h2>

              <form onSubmit={createUser} className="mt-4 space-y-3">
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
                    Amministrativo: riordino e funzioni ufficio. Punto Vendita: giacenze/inventario.
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
            </section>

            {/* crea PV */}
            <section className="rounded-2xl border bg-white p-4">
              <h2 className="text-lg font-semibold">Crea PV</h2>
              <p className="text-sm text-gray-600 mt-1">
                Inserisci un codice (es. A1) e un nome (es. Diversivo).
              </p>

              <form onSubmit={createPV} className="mt-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <input
                    className="w-full rounded-xl border p-3 md:col-span-1"
                    placeholder="Codice (es. A1)"
                    value={pvCode}
                    onChange={(e) => setPvCode(e.target.value)}
                  />

                  <input
                    className="w-full rounded-xl border p-3 md:col-span-2"
                    placeholder="Nome (es. Diversivo)"
                    value={pvName}
                    onChange={(e) => setPvName(e.target.value)}
                  />
                </div>

                <button
                  className="w-full rounded-xl bg-slate-900 text-white p-3 disabled:opacity-60"
                  disabled={pvLoading || !pvCode.trim() || !pvName.trim()}
                >
                  {pvLoading ? "Creazione..." : "Crea PV"}
                </button>

                {pvMsg && <p className="text-sm">{pvMsg}</p>}
              </form>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}





