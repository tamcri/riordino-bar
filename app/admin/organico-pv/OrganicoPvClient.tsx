"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type EmployeeRow = {
  id: string;
  name: string;
  active: boolean;
  counts_in_staff?: boolean;
  contract_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type StaffPvRow = {
  pv_id: string;
  pv_code: string;
  pv_name: string;
  min_employees: number | null;
  note: string | null;
  active_count: number;
  support_count?: number;
  shortage: number;
  status: "ok" | "shortage" | "not_configured";
  active_employees: EmployeeRow[];
  support_employees?: EmployeeRow[];
  inactive_employees: EmployeeRow[];
};

function pvLabel(row: StaffPvRow) {
  return `${row.pv_code} - ${row.pv_name}`;
}

function statusLabel(row: StaffPvRow) {
  if (row.status === "not_configured") return "Non configurato";
  if (row.status === "shortage") return `Carenza di ${row.shortage}`;
  return "OK";
}

function statusClass(row: StaffPvRow) {
  if (row.status === "shortage") return "border-red-200 bg-red-50 text-red-800";
  if (row.status === "not_configured") return "border-slate-200 bg-slate-100 text-slate-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-800";
}

function contractTypeLabel(value?: string | null) {
  return value === "part_time" ? "Part Time" : "Full Time";
}

function safeFilePart(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_\-.]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export default function OrganicoPvClient() {
  const [rows, setRows] = useState<StaffPvRow[]>([]);
  const [selectedPvId, setSelectedPvId] = useState("");
  const [minEmployees, setMinEmployees] = useState("0");
  const [note, setNote] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedRow = useMemo(
    () => rows.find((row) => row.pv_id === selectedPvId) ?? null,
    [rows, selectedPvId]
  );

  const employeesToShow = useMemo(() => {
    if (!selectedRow) return [] as EmployeeRow[];
    return showInactive
      ? [...selectedRow.active_employees, ...selectedRow.inactive_employees]
      : selectedRow.active_employees;
  }, [selectedRow, showInactive]);

  async function loadRows(nextSelectedPvId?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/staff-overview", { cache: "no-store" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Errore caricamento organico PV.");
      }

      const nextRows = Array.isArray(json.rows) ? (json.rows as StaffPvRow[]) : [];
      setRows(nextRows);

      const wantedPvId = nextSelectedPvId || selectedPvId;
      const nextSelected =
        nextRows.find((row) => row.pv_id === wantedPvId) ?? nextRows[0] ?? null;

      if (nextSelected) {
        setSelectedPvId(nextSelected.pv_id);
        setMinEmployees(String(nextSelected.min_employees ?? 0));
        setNote(nextSelected.note ?? "");
      } else {
        setSelectedPvId("");
        setMinEmployees("0");
        setNote("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore caricamento organico PV.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectPv(pvId: string) {
    const row = rows.find((item) => item.pv_id === pvId) ?? null;
    setSelectedPvId(pvId);
    setMinEmployees(String(row?.min_employees ?? 0));
    setNote(row?.note ?? "");
    setMessage(null);
    setError(null);
  }

  async function saveSettings() {
    if (!selectedPvId) {
      setError("Seleziona un punto vendita.");
      return;
    }

    const minValue = Number.parseInt(minEmployees, 10);
    if (!Number.isFinite(minValue) || minValue < 0) {
      setError("Inserisci un organico minimo valido.");
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/admin/staff-settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pv_id: selectedPvId,
          min_employees: minValue,
          note,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Errore salvataggio impostazione.");
      }
      setMessage("Impostazione organico salvata.");
      await loadRows(selectedPvId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore salvataggio impostazione.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadPdf() {
    if (!selectedRow) {
      setError("Seleziona un punto vendita.");
      return;
    }

    setPdfLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ pv_id: selectedRow.pv_id });
      const res = await fetch(`/api/admin/staff-pdf?${params.toString()}`);
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        throw new Error(json?.error || "Errore generazione PDF organico.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `organico-${safeFilePart(selectedRow.pv_code)}-${safeFilePart(selectedRow.pv_name)}.pdf`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore generazione PDF organico.");
    } finally {
      setPdfLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Organico PV</h1>
            <p className="text-gray-600 mt-1">
              Controlla i dipendenti attivi dei punti vendita e imposta l&apos;organico minimo desiderato.
            </p>
          </div>

          <Link href="/admin" className="rounded-xl border bg-white px-4 py-2 text-sm hover:bg-gray-50">
            Torna ad Admin
          </Link>
        </div>

        {message && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
        {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}

        <section className="rounded-2xl border bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Riepilogo punti vendita</h2>
              <p className="text-sm text-gray-600 mt-1">
                L&apos;alert scatta quando i dipendenti di organico stabile sono meno dell&apos;organico minimo impostato.
              </p>
            </div>

            <button
              type="button"
              className="rounded-xl border bg-white px-4 py-3 text-sm hover:bg-gray-50"
              onClick={() => loadRows(selectedPvId)}
              disabled={loading}
            >
              {loading ? "Caricamento..." : "Aggiorna"}
            </button>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-3 py-2 text-left">PV</th>
                  <th className="px-3 py-2 text-right">Organico stabile</th>
                  <th className="px-3 py-2 text-right">Supporti</th>
                  <th className="px-3 py-2 text-right">Organico minimo</th>
                  <th className="px-3 py-2 text-left">Stato</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.pv_id}
                    className={`border-t cursor-pointer hover:bg-slate-50 ${row.pv_id === selectedPvId ? "bg-blue-50" : ""}`}
                    onClick={() => selectPv(row.pv_id)}
                  >
                    <td className="px-3 py-2 font-medium">{pvLabel(row)}</td>
                    <td className="px-3 py-2 text-right">{row.active_count}</td>
                    <td className="px-3 py-2 text-right">{row.support_count ?? 0}</td>
                    <td className="px-3 py-2 text-right">{row.min_employees ?? "-"}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(row)}`}>
                        {statusLabel(row)}
                      </span>
                    </td>
                  </tr>
                ))}

                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                      Nessun punto vendita trovato.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {selectedRow && (
          <section className="rounded-2xl border bg-white p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Dettaglio {pvLabel(selectedRow)}</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Organico stabile: <b>{selectedRow.active_count}</b> · Supporti temporanei:{" "}
                  <b>{selectedRow.support_count ?? 0}</b> · Organico minimo:{" "}
                  <b>{selectedRow.min_employees ?? "non configurato"}</b>
                </p>
                <div className="mt-2">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(selectedRow)}`}>
                    {statusLabel(selectedRow)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-white disabled:opacity-60"
                onClick={downloadPdf}
                disabled={pdfLoading}
              >
                {pdfLoading ? "Generazione..." : "Scarica PDF dettaglio PV"}
              </button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
              <div className="rounded-2xl border bg-slate-50 p-4">
                <h3 className="font-semibold">Impostazione organico</h3>
                <div className="mt-4 space-y-3">
                  <label className="block">
                    <span className="block text-sm font-medium mb-2">Organico minimo desiderato</span>
                    <input
                      type="number"
                      min={0}
                      max={999}
                      className="w-full rounded-xl border bg-white p-3"
                      value={minEmployees}
                      onChange={(event) => setMinEmployees(event.target.value)}
                    />
                  </label>

                  <label className="block">
                    <span className="block text-sm font-medium mb-2">Nota interna</span>
                    <textarea
                      className="min-h-[90px] w-full rounded-xl border bg-white p-3"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      placeholder="Esempio: minimo rinforzato nel weekend o nel periodo estivo."
                    />
                  </label>

                  <button
                    type="button"
                    className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-white disabled:opacity-60"
                    onClick={saveSettings}
                    disabled={saving}
                  >
                    {saving ? "Salvataggio..." : "Salva impostazione"}
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="font-semibold">Dipendenti del PV</h3>
                    <p className="text-sm text-gray-600 mt-1">
                      L&apos;organico stabile viene confrontato con il minimo impostato. I supporti temporanei restano utilizzabili nei turni ma non contano nell&apos;organico.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={showInactive}
                      onChange={(event) => setShowInactive(event.target.checked)}
                    />
                    Mostra anche disattivati
                  </label>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-700">
                      <tr>
                       <th className="px-3 py-2 text-left">Dipendente</th>
                       <th className="px-3 py-2 text-left">Tipo</th>
                       <th className="px-3 py-2 text-left">Stato</th>
                       <th className="px-3 py-2 text-left">Contratto</th>
                      </tr>
                    </thead>
                    <tbody>
                      {employeesToShow.map((employee) => (
                        <tr key={employee.id} className="border-t">
                          <td className="px-3 py-2 font-medium">{employee.name}</td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
                                employee.counts_in_staff === false
                                  ? "border-amber-200 bg-amber-50 text-amber-800"
                                  : "border-blue-200 bg-blue-50 text-blue-800"
                              }`}
                            >
                              {employee.counts_in_staff === false ? "Supporto temporaneo" : "Organico stabile"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${
                                employee.active
                                  ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                  : "border-slate-200 bg-slate-100 text-slate-700"
                              }`}
                            >
                              {employee.active ? "Attivo" : "Disattivato"}
                            </span>
                          </td>
                            <td className="px-3 py-2">
                            {contractTypeLabel(employee.contract_type)}
                          </td>
                        </tr>
                      ))}

                      {employeesToShow.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                            Nessun dipendente da mostrare.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {selectedRow.support_employees && selectedRow.support_employees.length > 0 && (
                  <div className="mt-6">
                    <h3 className="font-semibold">Supporti temporanei</h3>
                    <p className="mt-1 text-sm text-slate-600">
                      Questi dipendenti possono essere usati nei turni del PV, ma non vengono conteggiati nell&apos;organico minimo.
                    </p>

                    <div className="mt-3 overflow-x-auto rounded-2xl border">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-600">
                          <tr>
                           <th className="px-4 py-3">Dipendente</th>
                          <th className="px-4 py-3">Tipo</th>
                          <th className="px-4 py-3">Contratto</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {selectedRow.support_employees.map((employee) => (
                            <tr key={employee.id}>
                              <td className="px-4 py-3 font-medium">{employee.name}</td>
                              <td className="px-4 py-3">
                                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
                                  Supporto temporaneo
                                </span>
                              </td>
                                <td className="px-4 py-3">
                                {contractTypeLabel(employee.contract_type)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
