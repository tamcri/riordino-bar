"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type CreateRole = "amministrativo" | "punto_vendita";

type PV = { id: string; code: string; name: string };
type AppUser = { id: string; username: string; role: string; pv_id: string | null };

// ✅ Timeline: categorie
type Category = { id: string; name: string };

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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

  // ✅ Timeline Giacenze
  const [categories, setCategories] = useState<Category[]>([]);
  const [tlPvId, setTlPvId] = useState<string>("");
  // ✅ "" = tutte, "__NULL__" = solo inventory.category_id NULL, uuid = categoria specifica
  const [tlCategoryId, setTlCategoryId] = useState<string>(""); // default: Tutte
  const [tlDateFrom, setTlDateFrom] = useState<string>("");
  const [tlDateTo, setTlDateTo] = useState<string>(todayISO());
  const [tlMsg, setTlMsg] = useState<string | null>(null);
  const [tlLoading, setTlLoading] = useState(false);
  const [tlPdfLoading, setTlPdfLoading] = useState(false);

  const selectedUser = useMemo(() => pvUsers.find((u) => u.id === assignUserId) || null, [pvUsers, assignUserId]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function loadPvsAndUsers() {
    setDataMsg(null);
    try {
      // Lista PV
      const resPvs = await fetch("/api/pvs/list", { cache: "no-store" });
      const jsonPvs = await resPvs.json().catch(() => null);

      const pvList = (jsonPvs?.pvs ?? jsonPvs?.rows) ?? [];
      const normalizedPvs = Array.isArray(pvList) ? pvList : [];
      setPvs(normalizedPvs);

      if (!tlPvId && normalizedPvs?.[0]?.id) setTlPvId(normalizedPvs[0].id);

      // Lista utenti PV
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

  async function loadCategories() {
    try {
      const res = await fetch("/api/categories/list", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      const rows = (json?.rows ?? []) as any[];
      const normalized = Array.isArray(rows) ? rows : [];
      setCategories(normalized);

      // ✅ NON setto più default su prima categoria: voglio lasciare "Tutte"
    } catch {
      // non blocca admin
    }
  }

  useEffect(() => {
    loadPvsAndUsers();
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (role !== "punto_vendita") setPvIdForNewUser("");
  }, [role]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    try {
      const body: any = { username, password, role };
      if (role === "punto_vendita") body.pv_id = pvIdForNewUser || null;

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
      setMsg(`Utente creato con successo (${role === "amministrativo" ? "Amministrativo" : "Punto Vendita"})`);
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
          pv_id: assignPvId || null,
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

  // ✅ Timeline Excel download
  async function downloadTimelineExcel() {
    setTlMsg(null);

    if (!tlPvId) return setTlMsg("Seleziona un PV.");
    if (!tlDateFrom || !tlDateTo) return setTlMsg("Imposta Data da e Data a.");

    setTlLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("pv_id", tlPvId);
      params.set("category_id", tlCategoryId); // "" | "__NULL__" | uuid
      params.set("date_from", tlDateFrom);
      params.set("date_to", tlDateTo);

      const res = await fetch(`/api/admin/timeline/excel?${params.toString()}`, { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Errore generazione Excel timeline");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `timeline_giacenze_${tlDateFrom}_${tlDateTo}.xlsx`;
      a.click();

      window.URL.revokeObjectURL(url);
      setTlMsg("Download Excel avviato.");
    } catch (e: any) {
      setTlMsg(e?.message || "Errore");
    } finally {
      setTlLoading(false);
    }
  }

  // ✅ PDF Pivot (Δ)
  async function downloadTimelinePivotPdf() {
    setTlMsg(null);

    if (!tlPvId) return setTlMsg("Seleziona un PV.");
    if (!tlDateFrom || !tlDateTo) return setTlMsg("Imposta Data da e Data a.");

    setTlPdfLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("pv_id", tlPvId);
      params.set("category_id", tlCategoryId); // "" | "__NULL__" | uuid
      params.set("date_from", tlDateFrom);
      params.set("date_to", tlDateTo);

      const res = await fetch(`/api/admin/timeline/pivot-pdf?${params.toString()}`, { method: "GET" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Errore generazione PDF pivot");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `timeline_pivot_${tlDateFrom}_${tlDateTo}.pdf`;
      a.click();

      window.URL.revokeObjectURL(url);
      setTlMsg("Download PDF avviato.");
    } catch (e: any) {
      setTlMsg(e?.message || "Errore");
    } finally {
      setTlPdfLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-6xl px-6 py-6 space-y-6">
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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <section className="rounded-2xl border bg-white p-4 lg:col-span-1">
            <h2 className="text-lg font-semibold">Area Operativa</h2>
            <p className="text-sm text-gray-600 mt-1">Link rapidi alle funzioni operative (resti admin, non perdi nulla).</p>

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

              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/admin/deposits">
                Depositi (Magazzini)
              </Link>

              <Link className="rounded-xl border p-3 hover:bg-gray-50" href="/admin/alerts">
                Soglie &amp; Alert
              </Link>

              <div className="pt-3 border-t mt-2">
                <p className="text-xs text-gray-500">
                  Tip: nel menu dell’area operativa aggiungeremo anche il tasto “Admin” per tornare qui.
                </p>
              </div>
            </div>
          </section>

          <div className="lg:col-span-2 space-y-6">
            {/* ✅ Timeline Giacenze */}
            <section className="rounded-2xl border bg-white p-4">
              <h2 className="text-lg font-semibold">Timeline Giacenze</h2>
              <p className="text-sm text-gray-600 mt-1">
                Excel multi-foglio per categoria (come storico inventario) + PDF pivot (multi-pagina).
              </p>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-2">Punto Vendita</label>
                  <select className="w-full rounded-xl border p-3 bg-white" value={tlPvId} onChange={(e) => setTlPvId(e.target.value)}>
                    <option value="">— Seleziona —</option>
                    {pvs.map((pv) => (
                      <option key={pv.id} value={pv.id}>
                        {pv.code} — {pv.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Categoria</label>
                  <select className="w-full rounded-xl border p-3 bg-white" value={tlCategoryId} onChange={(e) => setTlCategoryId(e.target.value)}>
                    <option value="">Tutte (incluse senza categoria)</option>
                    <option value="__NULL__">Solo inventari senza categoria (NULL)</option>
                    <option value="__SEP__" disabled>
                      ─────────────
                    </option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    Se Tabacchi ti risulta salvata con category_id NULL, usa “Solo inventari senza categoria (NULL)” oppure “Tutte”.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Data da</label>
                  <input type="date" className="w-full rounded-xl border p-3 bg-white" value={tlDateFrom} onChange={(e) => setTlDateFrom(e.target.value)} />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Data a</label>
                  <input type="date" className="w-full rounded-xl border p-3 bg-white" value={tlDateTo} onChange={(e) => setTlDateTo(e.target.value)} />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-xl bg-slate-900 text-white px-4 py-2 disabled:opacity-60"
                  disabled={tlLoading}
                  onClick={downloadTimelineExcel}
                >
                  {tlLoading ? "Genero..." : "Scarica Excel Timeline"}
                </button>

                <button
                  type="button"
                  className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50 disabled:opacity-60"
                  disabled={tlPdfLoading}
                  onClick={downloadTimelinePivotPdf}
                >
                  {tlPdfLoading ? "Genero..." : "Scarica PDF Pivot"}
                </button>

                {tlMsg && <div className="text-sm text-gray-700">{tlMsg}</div>}
              </div>
            </section>

            {/* crea utente */}
            <section className="rounded-2xl border bg-white p-4">
              <h2 className="text-lg font-semibold">Crea nuovo utente</h2>

              <form onSubmit={createUser} className="mt-4 space-y-3">
                <input className="w-full rounded-xl border p-3" placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
                <input className="w-full rounded-xl border p-3" placeholder="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />

                <div>
                  <label className="block text-sm font-medium mb-2">Ruolo</label>
                  <select className="w-full rounded-xl border p-3 bg-white" value={role} onChange={(e) => setRole(e.target.value as CreateRole)}>
                    <option value="amministrativo">Amministrativo</option>
                    <option value="punto_vendita">Punto Vendita</option>
                  </select>
                  <p className="text-xs text-gray-500 mt-1">Amministrativo: riordino e funzioni ufficio. Punto Vendita: giacenze/inventario.</p>
                </div>

                {role === "punto_vendita" && (
                  <div>
                    <label className="block text-sm font-medium mb-2">Assegna PV (opzionale)</label>
                    <select className="w-full rounded-xl border p-3 bg-white" value={pvIdForNewUser} onChange={(e) => setPvIdForNewUser(e.target.value)}>
                      <option value="">— Nessuno —</option>
                      {pvs.map((pv) => (
                        <option key={pv.id} value={pv.id}>
                          {pv.code} — {pv.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">Se non lo assegni ora, lo puoi fare sotto in “Assegna utente a PV”.</p>
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
                  <input className="w-full rounded-xl border p-3 md:col-span-1" placeholder="Codice (es. A1)" value={pvCode} onChange={(e) => setPvCode(e.target.value)} />
                  <input className="w-full rounded-xl border p-3 md:col-span-2" placeholder="Nome (es. Diversivo)" value={pvName} onChange={(e) => setPvName(e.target.value)} />
                </div>

                <button className="w-full rounded-xl bg-slate-900 text-white p-3 disabled:opacity-60" disabled={pvLoading || !pvCode.trim() || !pvName.trim()}>
                  {pvLoading ? "Creazione..." : "Crea PV"}
                </button>

                {pvMsg && <p className="text-sm">{pvMsg}</p>}
              </form>
            </section>

            {/* assegna utente a PV */}
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
                  <select className="w-full rounded-xl border p-3 bg-white" value={assignPvId} onChange={(e) => setAssignPvId(e.target.value)} disabled={!assignUserId}>
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

                <button className="w-full rounded-xl bg-slate-900 text-white p-3 disabled:opacity-60" disabled={assignLoading || !assignUserId}>
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










