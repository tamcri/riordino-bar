'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

type Item = {
  id: string;
  pv_id: string;
  pv_code: string;
  pv_name: string;
  label: string;
  identifier?: string | null;
  qr_image_url?: string | null;
  last_verification_date: string | null;
  next_verification_date: string | null;
  status: 'neutral' | 'green' | 'yellow' | 'orange' | 'red' | string;
  status_label: string;
  alert: string;
  is_enabled?: boolean;
  updated_at?: string | null;
};

type FilterKey = 'all' | 'due' | 'expired';

function formatDateIT(value: string | null | undefined) {
  if (!value) return '-';

  const parts = value.split('-');
  if (parts.length !== 3) return value;

  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function getStatusBadgeClass(status: Item['status']) {
  switch (status) {
    case 'green':
      return 'border-green-200 bg-green-100 text-green-800';
    case 'yellow':
      return 'border-yellow-200 bg-yellow-100 text-yellow-800';
    case 'orange':
      return 'border-orange-200 bg-orange-100 text-orange-800';
    case 'red':
      return 'border-red-200 bg-red-100 text-red-800';
    default:
      return 'border-gray-200 bg-gray-100 text-gray-700';
  }
}

function getFilterButtonClass(active: boolean) {
  return active
    ? 'rounded-xl border border-gray-900 bg-gray-900 px-4 py-2 text-sm font-medium text-white shadow-sm'
    : 'rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50';
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function calculateNextVerificationDate(value: string | null | undefined): string | null {
  const date = parseIsoDate(value);
  if (!date) return null;

  date.setFullYear(date.getFullYear() + 2);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getDaysRemaining(nextVerificationDate: string | null | undefined): number | null {
  const target = parseIsoDate(nextVerificationDate);
  if (!target) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);

  const diffMs = target.getTime() - today.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getStatus(nextVerificationDate: string | null | undefined) {
  const daysRemaining = getDaysRemaining(nextVerificationDate);

  if (daysRemaining === null) return 'neutral';
  if (daysRemaining < 0) return 'red';
  if (daysRemaining <= 15) return 'orange';
  if (daysRemaining <= 30) return 'yellow';
  return 'green';
}

function getStatusLabel(nextVerificationDate: string | null | undefined) {
  const daysRemaining = getDaysRemaining(nextVerificationDate);

  if (daysRemaining === null) return 'Da impostare';
  if (daysRemaining < 0) return 'Scaduta';
  if (daysRemaining <= 15) return 'Scade entro 15 giorni';
  if (daysRemaining <= 30) return 'Scade entro 30 giorni';
  return 'Tutto ok';
}

function getAlert(nextVerificationDate: string | null | undefined) {
  const daysRemaining = getDaysRemaining(nextVerificationDate);

  if (daysRemaining === null) return 'Da impostare';
  if (daysRemaining < 0) return 'Verifica scaduta';
  if (daysRemaining <= 15) return `Scade tra ${daysRemaining} giorni`;
  if (daysRemaining <= 30) return `Scade tra ${daysRemaining} giorni`;
  return 'Nessun alert';
}

export default function VerificaCassaAdminClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [activatingPvId, setActivatingPvId] = useState<string | null>(null);
  const [disablingPvId, setDisablingPvId] = useState<string | null>(null);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [draftDates, setDraftDates] = useState<Record<string, string>>({});
  const [draftIdentifiers, setDraftIdentifiers] = useState<Record<string, string>>({});
  const [zoomedQr, setZoomedQr] = useState<{
    url: string;
    title: string;
  } | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  async function loadData() {
    try {
      const res = await fetch(`/api/admin/cash-registers/list?t=${Date.now()}`, {
        cache: 'no-store',
      });

      const data = await res.json();
      const loadedItems: Item[] = data.items || [];

      setItems(loadedItems);

      setDraftDates((prev) => {
        const next = { ...prev };
        for (const item of loadedItems) {
          next[item.id] = item.last_verification_date || '';
        }
        return next;
      });

      setDraftIdentifiers((prev) => {
        const next = { ...prev };
        for (const item of loadedItems) {
          next[item.id] = item.identifier || '';
        }
        return next;
      });
    } catch (error) {
      console.error('Errore caricamento verifica cassa:', error);
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const rows = useMemo(() => {
    let filtered = items;

    if (activeFilter === 'due') {
      filtered = filtered.filter(
        (item) =>
          item.status === 'yellow' ||
          item.status === 'orange' ||
          item.status === 'red',
      );
    }

    if (activeFilter === 'expired') {
      filtered = filtered.filter((item) => item.status === 'red');
    }

    return filtered;
  }, [items, activeFilter]);

  const pvActionRows = useMemo(() => {
    const grouped = new Map<
      string,
      {
        pv_id: string;
        pv_code: string;
        pv_name: string;
        hasCassa1: boolean;
        hasCassa2: boolean;
      }
    >();

    for (const item of items) {
      const existing = grouped.get(item.pv_id) ?? {
        pv_id: item.pv_id,
        pv_code: item.pv_code,
        pv_name: item.pv_name,
        hasCassa1: false,
        hasCassa2: false,
      };

      if (item.label === 'Cassa 1') existing.hasCassa1 = true;
      if (item.label === 'Cassa 2') existing.hasCassa2 = true;

      grouped.set(item.pv_id, existing);
    }

    return [...grouped.values()].sort((a, b) =>
      `${a.pv_code}`.localeCompare(`${b.pv_code}`, 'it'),
    );
  }, [items]);

  async function handleSave(item: Item) {
    const value = draftDates[item.id] || '';
    const identifier = draftIdentifiers[item.id] || '';

    try {
      setSavingId(item.id);

      const saveRes = await fetch('/api/admin/cash-registers/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          id: item.id,
          identifier: identifier || null,
          last_verification_date: value || null,
        }),
      });

      const saveData = await saveRes.json();

      if (!saveRes.ok) {
        alert(saveData?.error || 'Errore salvataggio');
        return;
      }

      const savedItem = saveData?.item;
      const nextDate = savedItem?.next_verification_date ?? calculateNextVerificationDate(value || null);
      const lastDate = savedItem?.last_verification_date ?? (value || null);
      const savedIdentifier = savedItem?.identifier ?? (identifier || null);

      setItems((prev) =>
        prev.map((row) =>
          row.id === item.id
            ? {
                ...row,
                identifier: savedIdentifier,
                last_verification_date: lastDate,
                next_verification_date: nextDate,
                status: getStatus(nextDate),
                status_label: getStatusLabel(nextDate),
                alert: getAlert(nextDate),
              }
            : row,
        ),
      );

      setDraftDates((prev) => ({
        ...prev,
        [item.id]: lastDate || '',
      }));

      setDraftIdentifiers((prev) => ({
        ...prev,
        [item.id]: savedIdentifier || '',
      }));
    } catch (err) {
      console.error('Errore salvataggio:', err);
      alert('Errore salvataggio');
    } finally {
      setSavingId(null);
    }
  }

  async function handleQrUpload(item: Item, file: File | null) {
    if (!file) return;

    try {
      setUploadingId(item.id);

      const formData = new FormData();
      formData.append('id', item.id);
      formData.append('file', file);

      const res = await fetch('/api/admin/cash-registers/upload-qr', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data?.error || 'Errore upload QR');
        return;
      }

      await loadData();

      const input = fileInputRefs.current[item.id];
      if (input) {
        input.value = '';
      }
    } catch (error) {
      console.error('Errore upload QR:', error);
      alert('Errore upload QR');
    } finally {
      setUploadingId(null);
    }
  }

  async function handleActivateSecondCash(pvId: string) {
    try {
      setActivatingPvId(pvId);

      const res = await fetch('/api/admin/cash-registers/toggle-second', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pv_id: pvId, enabled: true }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data?.error || 'Errore attivazione Cassa 2');
        return;
      }

      await loadData();
    } catch (error) {
      console.error('Errore attivazione Cassa 2:', error);
      alert('Errore attivazione Cassa 2');
    } finally {
      setActivatingPvId(null);
    }
  }

  async function handleDisableSecondCash(pvId: string) {
    try {
      setDisablingPvId(pvId);

      const res = await fetch('/api/admin/cash-registers/toggle-second', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pv_id: pvId, enabled: false }),
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data?.error || 'Errore disattivazione Cassa 2');
        return;
      }

      await loadData();
    } catch (error) {
      console.error('Errore disattivazione Cassa 2:', error);
      alert('Errore disattivazione Cassa 2');
    } finally {
      setDisablingPvId(null);
    }
  }

  async function handleDownloadReport() {
    try {
      setDownloadingReport(true);

      const res = await fetch('/api/admin/cash-registers/report', {
        method: 'GET',
        cache: 'no-store',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        alert(data?.error || 'Errore generazione PDF');
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = 'verifica-cassa-report.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();

      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Errore download report PDF:', error);
      alert('Errore download report PDF');
    } finally {
      setDownloadingReport(false);
    }
  }

  if (loading) {
    return <div className="p-6">Caricamento...</div>;
  }

  return (
    <>
      <div className="mx-auto max-w-7xl p-4 md:p-6">
        <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Verifica Cassa</h1>
            <p className="mt-1 text-sm text-gray-500">
              Gestione QR, verifiche e scadenze delle casse associate ai PV.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleDownloadReport}
              disabled={downloadingReport}
              className="inline-flex items-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {downloadingReport ? 'Generazione PDF...' : 'Report PDF'}
            </button>

            <Link
              href="/admin"
              className="inline-flex items-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Torna ad Admin
            </Link>
          </div>
        </div>

        <div className="mb-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setActiveFilter('all')}
            className={getFilterButtonClass(activeFilter === 'all')}
          >
            Tutte
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('due')}
            className={getFilterButtonClass(activeFilter === 'due')}
          >
            In scadenza
          </button>

          <button
            type="button"
            onClick={() => setActiveFilter('expired')}
            className={getFilterButtonClass(activeFilter === 'expired')}
          >
            Scadute
          </button>
        </div>

        <div className="mb-6 rounded-2xl border border-gray-200 bg-gray-50 p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-700">
            Gestione seconda cassa
          </h2>

          <div className="flex flex-wrap gap-2">
            {pvActionRows
              .filter((pv) => pv.hasCassa1 && !pv.hasCassa2)
              .map((pv) => (
                <button
                  key={pv.pv_id}
                  type="button"
                  onClick={() => handleActivateSecondCash(pv.pv_id)}
                  disabled={activatingPvId === pv.pv_id}
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {activatingPvId === pv.pv_id
                    ? `Attivazione ${pv.pv_code}...`
                    : `Attiva Cassa 2 - ${pv.pv_code} ${pv.pv_name}`}
                </button>
              ))}

            {pvActionRows.filter((pv) => pv.hasCassa1 && !pv.hasCassa2).length === 0 ? (
              <span className="text-sm text-gray-500">
                Tutti i PV visibili hanno già la seconda cassa attiva.
              </span>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">PV</th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">Cassa</th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">
                    Identificativo
                  </th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">QR Code</th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">
                    Ultima Verifica
                  </th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">
                    Prossima Verifica
                  </th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">Stato</th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">Alert</th>
                  <th className="border-b px-4 py-3 text-left font-semibold text-gray-700">Azioni</th>
                </tr>
              </thead>

              <tbody>
                {rows.map((item) => (
                  <tr key={item.id} className="align-top hover:bg-gray-50/60">
                    <td className="border-b px-4 py-4">
                      <div className="font-medium text-gray-900">{item.pv_code}</div>
                      <div className="text-xs text-gray-500">{item.pv_name}</div>
                    </td>

                    <td className="border-b px-4 py-4">
                      <span className="rounded-lg bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700">
                        {item.label}
                      </span>
                    </td>

                    <td className="border-b px-4 py-4">
                      <input
                        type="text"
                        value={draftIdentifiers[item.id] || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDraftIdentifiers((prev) => ({
                            ...prev,
                            [item.id]: value,
                          }));
                        }}
                        placeholder="Inserisci codice"
                        className="w-[180px] rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    </td>

                    <td className="border-b px-4 py-4">
                      <div className="flex min-w-[120px] flex-col gap-2">
                        {item.qr_image_url ? (
                          <button
                            type="button"
                            onClick={() =>
                              setZoomedQr({
                                url: item.qr_image_url as string,
                                title: `${item.pv_code} - ${item.pv_name} / ${item.label}`,
                              })
                            }
                            className="w-fit"
                          >
                            <img
                              src={item.qr_image_url}
                              alt={`QR ${item.pv_name} ${item.label}`}
                              className="h-20 w-20 rounded-xl border border-gray-200 bg-white object-contain p-1 hover:opacity-90"
                            />
                          </button>
                        ) : (
                          <div className="flex h-20 w-20 items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 text-center text-xs text-gray-400">
                            Nessun QR
                          </div>
                        )}

                        <input
                          ref={(el) => {
                            fileInputRefs.current[item.id] = el;
                          }}
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            const file = e.target.files?.[0] || null;
                            handleQrUpload(item, file);
                          }}
                          className="max-w-[180px] text-xs text-gray-600"
                        />

                        {uploadingId === item.id ? (
                          <span className="text-xs text-gray-500">Upload in corso...</span>
                        ) : null}
                      </div>
                    </td>

                    <td className="border-b px-4 py-4">
                      <input
                        type="date"
                        value={draftDates[item.id] || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDraftDates((prev) => ({
                            ...prev,
                            [item.id]: value,
                          }));
                        }}
                        className="w-[150px] rounded-xl border border-gray-300 px-3 py-2 text-sm"
                      />
                    </td>

                    <td className="border-b px-4 py-4 font-medium text-gray-800">
                      {formatDateIT(item.next_verification_date)}
                    </td>

                    <td className="border-b px-4 py-4">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getStatusBadgeClass(
                          item.status,
                        )}`}
                      >
                        {item.status_label}
                      </span>
                    </td>

                    <td className="border-b px-4 py-4">
                      <span className="text-sm text-gray-700">{item.alert}</span>
                    </td>

                    <td className="border-b px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => handleSave(item)}
                          disabled={savingId === item.id}
                          className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          {savingId === item.id ? 'Salvataggio...' : 'Salva'}
                        </button>

                        {item.label === 'Cassa 2' ? (
                          <button
                            type="button"
                            onClick={() => handleDisableSecondCash(item.pv_id)}
                            disabled={disablingPvId === item.pv_id}
                            className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                          >
                            {disablingPvId === item.pv_id
                              ? 'Disattivazione...'
                              : 'Disattiva Cassa 2'}
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}

                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-500">
                      Nessun risultato per il filtro selezionato
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {zoomedQr ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
          onClick={() => setZoomedQr(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-4xl rounded-2xl bg-white p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setZoomedQr(null)}
              className="absolute right-3 top-3 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Chiudi
            </button>

            <div className="mb-4 pr-20 text-sm font-semibold text-gray-800">
              {zoomedQr.title}
            </div>

            <div className="flex justify-center">
              <img
                src={zoomedQr.url}
                alt={zoomedQr.title}
                className="max-h-[75vh] max-w-full object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}