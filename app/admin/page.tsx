"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type CreateRole = "amministrativo" | "punto_vendita";

type PV = { id: string; code: string; name: string };
type AppUser = { id: string; username: string; role: string; pv_id: string | null };

export default function AdminPage() {
  const router = useRouter();

  // --- crea utente ---
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<CreateRole>("amministrativo");
  const [pvIdForNewUser, setPvIdForNewUser] = useState<string>("");

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // --- crea PV ---
  const [pvCode, setPvCode] = useState("");
  const [pvName, setPvName] = useState("");
  const [pvMsg, setPvMsg] = useState<string | null>(null);
  const [pvLoading, setPvLoading] = useState(false);

  // --- dati dropdown (PV + utenti PV) ---
  const [pvs, setPvs] = useState<PV[]>([]);
  const [pvUsers, setPvUsers] = useState<AppUser[]>([]);
  const [dataMsg, setDataMsg] = useState<string | null>(null);

  // --- assegna PV successivamente ---
  const [assignUserId, setAssignUserId] = useState<string>("");
  const [assignPvId, setAssignPvId] = useState<string>("");
  const [assignMsg, setAssignMsg] = useState<string | null>(null);
  const [assignLoading, setAssignLoading] = useState(false);

  const selectedUser = useMemo(
    () => pvUsers.find((u) => u.id === assignUserId) || null,
    [pvUsers, assignUserId]
  );

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function loadPvsAndUsers() {
    setDataMsg(null);
    try {
      // Lista PV (nel tuo progetto esiste /api/pvs/list e ritorna { ok:true, rows:[...] })
      // ma gestiamo anche il caso futuro { ok:true, pvs:[...] }
      const resPvs = await fetch("/api/pvs/list", { cache: "no-store" });
      const jsonPvs = await resPvs.json().catch(() => null);

      const pvList = (jsonPvs?.pvs ?? jsonPvs?.rows) ?? [];
      setPvs(Array.isArray(pvList) ? pvList : []);


      // Lista utenti PV (route nuova)
      const resUsers = await fetch("/api/users/list?role=punto_vendita", { cache: "no-store" });
      const jsonUsers = await resUsers.json().catch(() => null);
      if (resUsers.ok && jsonUsers?.users) setPvUsers(jsonUsers.users);

      if (!resPvs.ok || !resUsers.ok) {
        setDataMsg("Nota: non riesco a caricare PV o utenti PV (controlla le route /api/pvs/list e /api/users/list).");

      }
    } catch {
      setDataMsg("Errore caricamento dati (PV/utenti).");
    }
  }

  useEffect(() => {
    loadPvsAndUsers();
  }, []);

  // Se cambio ruolo e non è PV, pulisco scelta PV
  useEffect(() => {
    if (role !== "punto_vendita") setPvIdForNewUser("");
  }, [role]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const body: any = { username, password, role };

      // se sto creando un punto vendita, posso assegnare pv_id già ora
      if (role === "punto_vendita") {
        body.pv_id = pvIdForNewUser || null;
      }

      const res = await fetch("/api/users/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setMsg(json?.error || "Errore");
        return;
      }

      setUsername("");
      setPassword("");
      setMsg(
        `Utente creato con successo (${role === "amministrativo" ? "Amministrativo" : "Punto Vendita"})`
      );

      // refresh lista utenti PV dopo creazione
      await loadPvsAndUsers();
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

      // refresh PV dropdown dopo creazione PV
      await loadPvsAndUsers();
    } finally {
      setPvLoading(false);
    }
  }

  async function assignPvToUser(e: React.FormEvent) {
    e.preventDefault();
    setAssignMsg(null);

    if (!assignUserId) {
      setAssignMsg("Seleziona un utente.");
      return;
    }

    setAssignLoading(true);
    try {
      const res = await fetch("/api/users/assign-pv", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          user_id: assignUserId,
          pv_id: assignPvId || null, // null = rimuovi assegnazione
        }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setAssignMsg(json?.error || "Errore");
        return;
      }

      setAssignMsg("Assegnazione salvata.");
      await loadPvsAndUsers();
    } finally {
      setAssignLoading(false);
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

        {dataMsg && <div className="rounded-xl border bg-white p-3 text-sm text-gray-700">{dataMsg}</div>}

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

              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/user/inventories">
               Inventario (Inserimento)
              </Link>

              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/user/inventories/history">
               Storico Inventari
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

      {/* Assegna PV SOLO se ruolo = punto_vendita */}
      {role === "punto_vendita" && (
        <div>
          <label className="block text-sm font-medium mb-2">Assegna PV (opzionale)</label>
          <select
            className="w-full rounded-xl border p-3 bg-white"
            value={pvIdForNewUser}
            onChange={(e) => setPvIdForNewUser(e.target.value)}
          >
            <option value="">— Nessuno —</option>
            {pvs.map((pv) => (
              <option key={pv.id} value={pv.id}>
                {pv.code} — {pv.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Se non lo assegni ora, lo puoi fare sotto in “Assegna utente a PV”.
          </p>
        </div>
      )}

      <button className="w-full rounded-xl bg-black text-white p-3 disabled:opacity-60" disabled={loading}>
        {loading ? "Creazione..." : "Crea utente"}
      </button>

      {msg && <p className="text-sm">{msg}</p>}
    </form>
  </section>

  {/* crea PV */}
  <section className="rounded-2xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Crea PV</h2>
    <p className="text-sm text-gray-600 mt-1">Inserisci un codice (es. A1) e un nome (es. Diversivo).</p>

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

  {/* assegna utente a PV (anche successivamente) */}
  <section className="rounded-2xl border bg-white p-4">
    <h2 className="text-lg font-semibold">Assegna utente a PV</h2>
    <p className="text-sm text-gray-600 mt-1">
      Serve per assegnare/cambiare PV agli utenti <b>punto_vendita</b> anche dopo la creazione.
    </p>

    <form onSubmit={assignPvToUser} className="mt-4 space-y-3">
      <div>
        <label className="block text-sm font-medium mb-2">Utente (solo Punto Vendita)</label>
        <select
          className="w-full rounded-xl border p-3 bg-white"
          value={assignUserId}
          onChange={(e) => {
            const id = e.target.value;
            setAssignUserId(id);
            const u = pvUsers.find((x) => x.id === id);
            setAssignPvId(u?.pv_id ?? "");
          }}
        >
          <option value="">— Seleziona utente —</option>
          {pvUsers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.username}
              {u.pv_id ? " (PV assegnato)" : " (nessun PV)"}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium mb-2">PV</label>
        <select
          className="w-full rounded-xl border p-3 bg-white"
          value={assignPvId}
          onChange={(e) => setAssignPvId(e.target.value)}
          disabled={!assignUserId}
        >
          <option value="">— Nessuno (rimuovi assegnazione) —</option>
          {pvs.map((pv) => (
            <option key={pv.id} value={pv.id}>
              {pv.code} — {pv.name}
            </option>
          ))}
        </select>

        {selectedUser && (
          <p className="text-xs text-gray-500 mt-1">
            Utente selezionato: <b>{selectedUser.username}</b>
          </p>
        )}
      </div>

      <button
        className="w-full rounded-xl bg-slate-900 text-white p-3 disabled:opacity-60"
        disabled={assignLoading || !assignUserId}
      >
        {assignLoading ? "Salvataggio..." : "Salva assegnazione"}
      </button>

      {assignMsg && <p className="text-sm">{assignMsg}</p>}
    </form>
  </section>
</div>

        </div>
      </div>
    </main>
  );
}







