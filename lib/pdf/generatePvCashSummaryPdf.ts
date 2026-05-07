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
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;

  const status = normalizeStatus(summary);
  const generatedAt = new Date().toLocaleString("it-IT");

  const totaleEntrate =
    n(summary.incasso_totale) +
    n(summary.vendita_gv) +
    n(summary.vendita_tabacchi) +
    n(summary.lis_plus) +
    n(summary.mooney);

  const totaleUscite =
    n(summary.pagamento_fornitori) +
    n(summary.gv_pagati) +
    n(summary.pos) +
    n(summary.spese_extra);

  let y = 10;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Riepilogo Incassato", margin, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`Generato il: ${generatedAt}`, pageWidth - margin, y, {
    align: "right",
  });

  y += 5;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Campo", "Valore", "Campo", "Valore"]],
    body: [
      ["Data", formatDate(summary.data), "Operatore", summary.operatore || "—"],
      ["Stato", statusLabel(status), "ID", summary.id],
    ],
    styles: compactStyle(),
    headStyles: darkHeadStyle(),
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      0: { fontStyle: "bold", cellWidth: 24 },
      1: { cellWidth: 42 },
      2: { fontStyle: "bold", cellWidth: 24 },
      3: { cellWidth: contentWidth - 90 },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 5;

  const halfGap = 4;
  const halfWidth = (contentWidth - halfGap) / 2;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Entrate", margin, y);
  pdf.text("Uscite", margin + halfWidth + halfGap, y);

  y += 2;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Voce", "Importo"]],
    body: [
      ["Incasso Totale", formatEuro(summary.incasso_totale)],
      ["Vendita G&V", formatEuro(summary.vendita_gv)],
      ["Vendita Tabacchi", formatEuro(summary.vendita_tabacchi)],
      ["LIS+", formatEuro(summary.lis_plus)],
      ["Mooney", formatEuro(summary.mooney)],
      [
  { content: "Totale Entrate", styles: { fontStyle: "bold" } },
  {
    content: formatEuro(totaleEntrate),
    styles: { fontStyle: "bold", halign: "right" },
  },
],
    ],
    styles: compactStyle(),
    headStyles: blueHeadStyle(),
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: halfWidth - 48, halign: "right" },
    },
    margin: {
      left: margin,
      right: pageWidth - margin - halfWidth,
    },
  });

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Voce", "Importo"]],
    body: [
      ["Pagamento Fornitori", formatEuro(summary.pagamento_fornitori)],
      ["G&V Pagati", formatEuro(summary.gv_pagati)],
      ["POS", formatEuro(summary.pos)],
      ["Prelievo", formatEuro(summary.spese_extra)],
      [
  { content: "Totale Uscite", styles: { fontStyle: "bold" } },
  {
    content: formatEuro(totaleUscite),
    styles: { fontStyle: "bold", halign: "right" },
  },
],
      ["", ""],
    ],
    styles: compactStyle(),
    headStyles: blueHeadStyle(),
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      0: { cellWidth: 48 },
      1: { cellWidth: halfWidth - 48, halign: "right" },
    },
    margin: {
      left: margin + halfWidth + halfGap,
      right: margin,
    },
  });

  y = getFinalY(pdf) + 5;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    body: [["Versamento", formatEuro(summary.versamento)]],
    styles: {
      font: "helvetica",
      fontSize: 10,
      cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
      lineWidth: 0.1,
    },
    bodyStyles: {
      textColor: [15, 23, 42],
      fontStyle: "bold",
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: contentWidth / 2, fontStyle: "bold" },
      1: { cellWidth: contentWidth / 2, halign: "right", fontStyle: "bold" },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 5;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Pagamenti Fornitori", margin, y);

  y += 2;

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
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: { top: 1, right: 1.5, bottom: 1, left: 1.5 },
      lineWidth: 0.1,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [30, 64, 175],
      textColor: 255,
      fontStyle: "bold",
      fontSize: 7,
    },
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: contentWidth - 68 },
      2: { cellWidth: 40, halign: "right" },
    },
    margin: { left: margin, right: margin },
    didDrawPage: () => {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `Pagina ${pdf.getCurrentPageInfo().pageNumber} di ${pdf.getNumberOfPages()}`,
        pageWidth - margin,
        pageHeight - 5,
        { align: "right" }
      );
    },
  });

  y = getFinalY(pdf) + 5;

  if (y > 250) {
    pdf.addPage();
    y = 10;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Fondo Cassa", margin, y);

  y += 2;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Voce", "Importo", "Voce", "Importo"]],
    body: [
      [
        "Fondo Cassa Iniziale",
        formatEuro(summary.fondo_cassa_iniziale),
        "Fondo Cassa",
        formatEuro(summary.fondo_cassa),
      ],
      [
        "Differenza %",
        formatPercent(
          computeDeltaPercent(summary.fondo_cassa_iniziale, summary.fondo_cassa)
        ),
        "",
        "",
      ],
    ],
    styles: compactStyle(),
    headStyles: blueHeadStyle(),
    bodyStyles: {
      textColor: [51, 65, 85],
    },
    columnStyles: {
      0: { cellWidth: 50 },
      1: { cellWidth: 40, halign: "right" },
      2: { cellWidth: 50 },
      3: { cellWidth: contentWidth - 140, halign: "right" },
    },
    margin: { left: margin, right: margin },
  });

  const fileName = `Riepilogo-Incassato-${safeFileName(summary.data)}-${safeFileName(
    summary.operatore || "PV"
  )}.pdf`;

  pdf.save(fileName);
}

function compactStyle() {
  return {
    font: "helvetica",
    fontSize: 8,
    cellPadding: { top: 1.2, right: 1.5, bottom: 1.2, left: 1.5 },
    lineWidth: 0.1,
    overflow: "linebreak" as const,
  };
}

function darkHeadStyle() {
  return {
    fillColor: [15, 23, 42] as [number, number, number],
    textColor: 255,
    fontStyle: "bold" as const,
    fontSize: 8,
  };
}

function blueHeadStyle() {
  return {
    fillColor: [30, 64, 175] as [number, number, number],
    textColor: 255,
    fontStyle: "bold" as const,
    fontSize: 8,
  };
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

function computeDeltaPercent(
  initial: number | null | undefined,
  current: number | null | undefined
) {
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