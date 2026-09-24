"use client";

import { useEffect, useState } from "react";

type Supplier = {
  id: string;
  code: string;
  name: string;
  is_active?: boolean;
};

export default function SuppliersAdminClient() {
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Supplier[]>([]);
  const [listLoading, setListLoading] = useState(false);

  const [actionLoadingId, setActionLoadingId] =
    useState<string | null>(null);

  async function loadSuppliers(search = "") {
    setListLoading(true);

    try {
      const res = await fetch(
        `/api/suppliers/search?q=${encodeURIComponent(search)}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setRows([]);
        return;
      }

      setRows(Array.isArray(json.rows) ? json.rows : []);
    } catch {
      setRows([]);
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    loadSuppliers("");
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();

    setMsg(null);

    const code = newCode.trim();
    const name = newName.trim();

    if (!code) {
      setMsg("Inserisci il codice del fornitore.");
      return;
    }

    if (!name) {
      setMsg("Inserisci la ragione sociale.");
      return;
    }

    setCreating(true);

    try {
      const res = await fetch("/api/suppliers/create", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          code,
          name,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(
          json?.error || "Errore inserimento fornitore"
        );
        return;
      }

      setMsg(
        `Fornitore ${code} - ${name} inserito correttamente.`
      );

      setNewCode("");
      setNewName("");

      await loadSuppliers(q);
    } catch (e: any) {
      setMsg(
        e?.message || "Errore inserimento fornitore"
      );
    } finally {
      setCreating(false);
    }
  }

  async function onImport(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);

    if (!file) {
      setMsg("Seleziona un file Excel.");
      return;
    }

    setLoading(true);

    try {
      const form = new FormData();
      form.append("file", file);

      const res = await fetch("/api/suppliers/import", {
        method: "POST",
        body: form,
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(
          json?.error || "Errore import fornitori"
        );
        return;
      }

      setMsg(
        `Import completato. Inseriti: ${
          json.inserted ?? 0
        }, aggiornati: ${json.updated ?? 0}.`
      );

      setFile(null);

      const input = document.getElementById(
        "suppliers-file-input"
      ) as HTMLInputElement | null;

      if (input) {
        input.value = "";
      }

      await loadSuppliers(q);
    } catch (e: any) {
      setMsg(
        e?.message || "Errore import fornitori"
      );
    } finally {
      setLoading(false);
    }
  }

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();

    await loadSuppliers(q);
  }

  async function dismissSupplier(id: string) {
    if (
      !confirm("Vuoi dismettere questo fornitore?")
    ) {
      return;
    }

    setMsg(null);
    setActionLoadingId(id);

    try {
      const res = await fetch(
        "/api/suppliers/dismiss",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ id }),
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(
          json?.error ||
            "Errore dismissione fornitore"
        );
        return;
      }

      setMsg("Fornitore dismesso.");

      await loadSuppliers(q);
    } catch (e: any) {
      setMsg(
        e?.message ||
          "Errore dismissione fornitore"
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  async function deleteSupplier(id: string) {
    if (
      !confirm(
        "Vuoi eliminare definitivamente questo fornitore?"
      )
    ) {
      return;
    }

    setMsg(null);
    setActionLoadingId(id);

    try {
      const res = await fetch(
        "/api/suppliers/delete",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ id }),
        }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(
          json?.error ||
            "Errore eliminazione fornitore"
        );
        return;
      }

      setMsg("Fornitore eliminato.");

      await loadSuppliers(q);
    } catch (e: any) {
      setMsg(
        e?.message ||
          "Errore eliminazione fornitore"
      );
    } finally {
      setActionLoadingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {/* NUOVO FORNITORE */}
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">
          Nuovo Fornitore
        </h2>

        <p className="mt-1 text-sm text-gray-600">
          Inserisci manualmente un nuovo fornitore senza
          utilizzare il file Excel.
        </p>

        <form
          onSubmit={onCreate}
          className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[220px_1fr_auto]"
        >
          <input
            type="text"
            className="w-full rounded-xl border p-3"
            placeholder="Codice"
            value={newCode}
            onChange={(e) =>
              setNewCode(e.target.value)
            }
            disabled={creating}
          />

          <input
            type="text"
            className="w-full rounded-xl border p-3"
            placeholder="Ragione Sociale"
            value={newName}
            onChange={(e) =>
              setNewName(e.target.value)
            }
            disabled={creating}
          />

          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-slate-900 px-5 py-2 text-white disabled:opacity-60"
          >
            {creating
              ? "Inserimento..."
              : "Inserisci"}
          </button>
        </form>
      </section>

      {/* IMPORT EXCEL */}
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">
          Import Excel Fornitori
        </h2>

        <p className="mt-1 text-sm text-gray-600">
          Formato richiesto: colonna 1 = Codice,
          colonna 2 = Ragione Sociale.
        </p>

        <form
          onSubmit={onImport}
          className="mt-4 space-y-3"
        >
          <input
            id="suppliers-file-input"
            type="file"
            accept=".xlsx,.xls"
            className="w-full rounded-xl border bg-white p-3"
            onChange={(e) =>
              setFile(
                e.target.files?.[0] ?? null
              )
            }
          />

          <button
            className="rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
            disabled={loading}
            type="submit"
          >
            {loading
              ? "Import in corso..."
              : "Importa fornitori"}
          </button>
        </form>
      </section>

      {/* MESSAGGIO */}
      {msg && (
        <div className="rounded-xl border bg-white px-4 py-3 text-sm text-gray-700">
          {msg}
        </div>
      )}

      {/* ELENCO FORNITORI */}
      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-lg font-semibold">
          Elenco Fornitori
        </h2>

        <form
          onSubmit={onSearch}
          className="mt-4 flex flex-col gap-3 md:flex-row"
        >
          <input
            className="w-full rounded-xl border p-3"
            placeholder="Cerca per codice o ragione sociale"
            value={q}
            onChange={(e) =>
              setQ(e.target.value)
            }
          />

          <button
            type="submit"
            className="rounded-xl border bg-white px-4 py-2 hover:bg-gray-50"
          >
            Cerca
          </button>
        </form>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="p-2 text-left">
                  Codice
                </th>

                <th className="p-2 text-left">
                  Ragione Sociale
                </th>

                <th className="p-2 text-center">
                  Stato
                </th>

                <th className="p-2 text-right">
                  Azioni
                </th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row) => {
                const busy =
                  actionLoadingId === row.id;

                return (
                  <tr
                    key={row.id}
                    className="border-t"
                  >
                    <td className="p-2">
                      {row.code}
                    </td>

                    <td className="p-2">
                      {row.name}
                    </td>

                    <td className="p-2 text-center">
                      {row.is_active === false
                        ? "Dismesso"
                        : "Attivo"}
                    </td>

                    <td className="space-x-2 p-2 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          dismissSupplier(row.id)
                        }
                        className="text-orange-600 hover:underline disabled:opacity-50"
                        disabled={
                          busy ||
                          row.is_active === false
                        }
                      >
                        Dismetti
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          deleteSupplier(row.id)
                        }
                        className="text-red-600 hover:underline disabled:opacity-50"
                        disabled={busy}
                      >
                        Elimina
                      </button>
                    </td>
                  </tr>
                );
              })}

              {!listLoading &&
                rows.length === 0 && (
                  <tr className="border-t">
                    <td
                      className="p-3 text-gray-500"
                      colSpan={4}
                    >
                      Nessun fornitore trovato.
                    </td>
                  </tr>
                )}

              {listLoading && (
                <tr className="border-t">
                  <td
                    className="p-3 text-gray-500"
                    colSpan={4}
                  >
                    Caricamento...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}