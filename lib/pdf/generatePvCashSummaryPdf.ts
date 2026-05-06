import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

type SummaryStatus = "bozza" | "completato" | "chiuso";

export type PvCashSummaryPdfSummary = {
  id: string;
  data: string;
  operatore: string;
  incasso_totale: number | null;
  pagamento_fornitori: number | null;
  gv_pagati: number | null;
  lis_plus: number | null;
  mooney: number | null;
  totale_esistenza_cassa: number | null;
  vendita_gv: number | null;
  vendita_tabacchi: number | null;
  totale: number | null;
  pos: number | null;
  spese_extra?: number | null;
  versamento: number | null;
  da_versare?: number | null;
  tot_versato?: number | null;
  fondo_cassa_iniziale?: number | null;
  parziale_1?: number | null;
  parziale_2?: number | null;
  parziale_3?: number | null;
  fondo_cassa: number | null;
  status?: string | null;
  is_closed: boolean;
};

export type PvCashSummaryPdfSupplier = {
  supplier_code?: string | null;
  supplier_name?: string | null;
  amount?: number | null;
};

export function generatePvCashSummaryPdf({
  summary,
  suppliers,
}: {
  summary: PvCashSummaryPdfSummary;
  suppliers: PvCashSummaryPdfSupplier[];
}) {
  const pdf = new jsPDF({
    orientation: "p",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 12;

  const status = normalizeStatus(summary);
  const generatedAt = new Date().toLocaleString("it-IT");

  let y = 14;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(18);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Riepilogo Incassato", margin, y);

  y += 7;

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`Generato il: ${generatedAt}`, margin, y);

  y += 8;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Campo", "Valore"]],
    body: [
      ["Data", formatDate(summary.data)],
      ["Operatore", summary.operatore || "—"],
      ["Stato", statusLabel(status)],
      ["ID riepilogo", summary.id],
    ],
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
      fontStyle: "bold",
    },
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 55 },
      1: { cellWidth: 125 },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 8;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Esistenza Cassa", margin, y);

  y += 4;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Voce", "Importo"]],
    body: [
      ["Incasso Totale", formatEuro(summary.incasso_totale)],
      ["Pagamento Fornitori", formatEuro(summary.pagamento_fornitori)],
      ["G&V Pagati", formatEuro(summary.gv_pagati)],
      ["LIS+", formatEuro(summary.lis_plus)],
      ["Mooney", formatEuro(summary.mooney)],
      ["Totale Esistenza Cassa", formatEuro(summary.totale_esistenza_cassa)],
    ],
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: "bold",
    },
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      1: { halign: "right" },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 8;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Vendite e Calcoli", margin, y);

  y += 4;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Voce", "Importo"]],
    body: [
      ["Vendita G&V", formatEuro(summary.vendita_gv)],
      ["Vendita Tabacchi", formatEuro(summary.vendita_tabacchi)],
      ["Totale", formatEuro(summary.totale)],
      ["POS", formatEuro(summary.pos)],
      ["Prelievo", formatEuro(summary.spese_extra)],
      ["Versamento", formatEuro(summary.versamento)],
    ],
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: "bold",
    },
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      1: { halign: "right" },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 8;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Fondo Cassa", margin, y);

  y += 4;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Voce", "Importo"]],
    body: [
      ["Fondo Cassa Iniziale", formatEuro(summary.fondo_cassa_iniziale)],
      ["Parziale 1", formatEuro(summary.parziale_1)],
      ["Parziale 2", formatEuro(summary.parziale_2)],
      ["Parziale 3", formatEuro(summary.parziale_3)],
      ["Fondo Cassa", formatEuro(summary.fondo_cassa)],
      [
        "Differenza % Fondo Cassa",
        formatPercent(computeDeltaPercent(summary.fondo_cassa_iniziale, summary.fondo_cassa)),
      ],
    ],
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: "bold",
    },
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      1: { halign: "right" },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 8;

  if (y > 235) {
    pdf.addPage();
    y = 14;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(13);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Pagamenti Fornitori", margin, y);

  y += 4;

  const supplierRows =
    suppliers.length > 0
      ? suppliers.map((supplier) => [
          String(supplier.supplier_code ?? "").trim() || "—",
          String(supplier.supplier_name ?? "").trim() || "—",
          formatEuro(supplier.amount),
        ])
      : [["—", "Nessun pagamento fornitore inserito", "—"]];

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Codice", "Ragione Sociale", "Importo"]],
    body: supplierRows,
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: "bold",
    },
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      2: { halign: "right" },
    },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      const currentPage = pdf.getCurrentPageInfo().pageNumber;
      const totalPages = pdf.getNumberOfPages();

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `Pagina ${currentPage} di ${totalPages}`,
        pageWidth - margin,
        pdf.internal.pageSize.getHeight() - 6,
        { align: "right" }
      );
    },
  });

  const fileName = `Riepilogo-Incassato-${safeFileName(summary.data)}-${safeFileName(
    summary.operatore || "PV"
  )}.pdf`;

  pdf.save(fileName);
}

function getFinalY(pdf: jsPDF) {
  return (pdf as any).lastAutoTable?.finalY ?? 20;
}

function n(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatEuro(value: number | null | undefined) {
  return Number(value ?? 0).toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";

  const [yyyy, mm, dd] = String(value).split("-");
  if (yyyy && mm && dd) return `${dd}/${mm}/${yyyy}`;

  return String(value);
}

function normalizeStatus(summary: PvCashSummaryPdfSummary): SummaryStatus {
  if (summary.is_closed || Number(summary.tot_versato ?? 0) > 0) {
    return "chiuso";
  }

  const raw = String(summary.status ?? "").trim().toLowerCase();

  if (raw === "bozza") return "bozza";
  if (raw === "completato") return "completato";
  if (raw === "chiuso") return "chiuso";

  return "bozza";
}

function statusLabel(status: SummaryStatus) {
  if (status === "chiuso") return "Chiuso";
  if (status === "completato") return "Completato";
  return "Bozza";
}

function computeDeltaPercent(initial: number | null | undefined, current: number | null | undefined) {
  const initialValue = n(initial);
  const currentValue = n(current);

  if (!Number.isFinite(initialValue) || !Number.isFinite(currentValue)) return null;
  if (initialValue === 0) return null;

  return ((currentValue - initialValue) / initialValue) * 100;
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";

  const sign = value > 0 ? "+" : "";

  return `${sign}${value.toLocaleString("it-IT", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function safeFileName(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]/g, "");
}