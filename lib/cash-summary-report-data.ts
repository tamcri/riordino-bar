import jsPDF from "jspdf";
import { autoTable } from "jspdf-autotable";

export type CashSummaryDataReportRow = {
  data: string;
  pv_label: string;
  operatore: string;
  incasso_totale: number;
  gv_pagati: number;
  lis_plus: number;
  mooney: number;
  vendita_gv: number;
  vendita_tabacchi: number;
  saldo_giorno: number;
  progressivo_da_versare: number;
  fondo_cassa: number;
};

export type GenerateCashSummaryDataReportArgs = {
  rows: CashSummaryDataReportRow[];
  pvLabel?: string;
  dateFrom?: string;
  dateTo?: string;
  generatedAt?: Date;
  title?: string;
  fileName?: string;
};

function formatEuro(value: number | null | undefined) {
  const num = Number(value ?? 0);
  return num.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
  });
}

function formatLongDate(value: string) {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function sumBy<T>(rows: T[], getter: (row: T) => number) {
  return rows.reduce((sum, row) => sum + getter(row), 0);
}

function safeText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function buildPeriodLabel(dateFrom?: string, dateTo?: string) {
  const from = dateFrom ? formatLongDate(dateFrom) : "inizio";
  const to = dateTo ? formatLongDate(dateTo) : "oggi";
  return `${from} - ${to}`;
}

function drawKpiBox(
  pdf: jsPDF,
  x: number,
  y: number,
  w: number,
  h: number,
  title: string,
  value: string
) {
  pdf.setDrawColor(203, 213, 225);
  pdf.setFillColor(248, 250, 252);
  pdf.roundedRect(x, y, w, h, 2, 2, "FD");

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  pdf.text(title, x + 3, y + 5);

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(10);
  pdf.setTextColor(15, 23, 42);
  pdf.text(value, x + 3, y + 11);
}

export function generateCashSummaryDataReport({
  rows,
  pvLabel,
  dateFrom,
  dateTo,
  generatedAt = new Date(),
  title = "Report Completo Riepiloghi Incassato",
  fileName = "report-completo-riepiloghi-incassato.pdf",
}: GenerateCashSummaryDataReportArgs) {
  const sortedRows = [...rows].sort((a, b) => {
    if (a.data !== b.data) return a.data.localeCompare(b.data);
    return a.pv_label.localeCompare(b.pv_label);
  });

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;

  const totals = {
    incasso_totale: sumBy(sortedRows, (row) => row.incasso_totale),
    gv_pagati: sumBy(sortedRows, (row) => row.gv_pagati),
    vendita_tabacchi: sumBy(sortedRows, (row) => row.vendita_tabacchi),
    vendita_gv: sumBy(sortedRows, (row) => row.vendita_gv),
    lis_plus: sumBy(sortedRows, (row) => row.lis_plus),
    mooney: sumBy(sortedRows, (row) => row.mooney),
    saldo_giorno: sumBy(sortedRows, (row) => row.saldo_giorno),
  };

  const selectedPvLabel = safeText(pvLabel) || "Tutti i PV";
  const periodLabel = buildPeriodLabel(dateFrom, dateTo);
  const generatedLabel = generatedAt.toLocaleString("it-IT");

  let y = 12;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(15, 23, 42);
  pdf.text(title, margin, y);

  y += 7;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`PV: ${selectedPvLabel}`, margin, y);

  y += 5;
  pdf.text(`Periodo: ${periodLabel}`, margin, y);

  y += 5;
  pdf.text(`Generato il: ${generatedLabel}`, margin, y);

  y += 8;
  const gap = 4;
  const boxWidth = (contentWidth - gap * 2) / 3;
  drawKpiBox(pdf, margin, y, boxWidth, 18, "Righe report", String(sortedRows.length));
  drawKpiBox(pdf, margin + boxWidth + gap, y, boxWidth, 18, "Totale Incasso", formatEuro(totals.incasso_totale));
  drawKpiBox(pdf, margin + (boxWidth + gap) * 2, y, boxWidth, 18, "Totale Tabacchi", formatEuro(totals.vendita_tabacchi));

  y += 22;
  drawKpiBox(pdf, margin, y, boxWidth, 18, "Totale G&V", formatEuro(totals.vendita_gv));
  drawKpiBox(pdf, margin + boxWidth + gap, y, boxWidth, 18, "Totale LIS+", formatEuro(totals.lis_plus));
  drawKpiBox(pdf, margin + (boxWidth + gap) * 2, y, boxWidth, 18, "Totale Mooney", formatEuro(totals.mooney));

  y += 24;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    margin: { left: margin, right: margin },
    styles: {
      font: "helvetica",
      fontSize: 7,
      cellPadding: 1.8,
      textColor: [51, 65, 85],
      valign: "middle",
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: 255,
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    head: [[
      "Data",
      "PV",
      "Operatore",
      "Incasso Totale",
      "Pagati G&V",
      "Vendita Tabacchi",
      "Vendita G&V",
      "LIS+",
      "Mooney",
      "Saldo giorno",
      "Progressivo",
      "Fondo cassa",
    ]],
    body: sortedRows.map((row) => [
      formatLongDate(row.data),
      row.pv_label,
      safeText(row.operatore) || "—",
      formatEuro(row.incasso_totale),
      formatEuro(row.gv_pagati),
      formatEuro(row.vendita_tabacchi),
      formatEuro(row.vendita_gv),
      formatEuro(row.lis_plus),
      formatEuro(row.mooney),
      formatEuro(row.saldo_giorno),
      formatEuro(row.progressivo_da_versare),
      formatEuro(row.fondo_cassa),
    ]),
    foot: [[
      "TOTALI",
      "",
      "",
      formatEuro(totals.incasso_totale),
      formatEuro(totals.gv_pagati),
      formatEuro(totals.vendita_tabacchi),
      formatEuro(totals.vendita_gv),
      formatEuro(totals.lis_plus),
      formatEuro(totals.mooney),
      formatEuro(totals.saldo_giorno),
      "",
      "",
    ]],
    footStyles: {
      fillColor: [226, 232, 240],
      textColor: [15, 23, 42],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 18 },
      1: { cellWidth: 28 },
      2: { cellWidth: 22 },
      3: { halign: "right", cellWidth: 22 },
      4: { halign: "right", cellWidth: 20 },
      5: { halign: "right", cellWidth: 24 },
      6: { halign: "right", cellWidth: 20 },
      7: { halign: "right", cellWidth: 17 },
      8: { halign: "right", cellWidth: 17 },
      9: { halign: "right", cellWidth: 20 },
      10: { halign: "right", cellWidth: 20 },
      11: { halign: "right", cellWidth: 20 },
    },
    didDrawPage: () => {
      const totalPages = pdf.getNumberOfPages();
      const currentPage = pdf.getCurrentPageInfo().pageNumber;

      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.setTextColor(100, 116, 139);
      pdf.text(
        `Pagina ${currentPage} di ${totalPages}`,
        pageWidth - margin,
        pageHeight - 5,
        { align: "right" }
      );
    },
  });

  const safePv = (pvLabel || "Tutti")
  .replace(/\s+/g, "")
  .replace(/[^\w\-]/g, "");

const safeFrom = dateFrom || "inizio";
const safeTo = dateTo || "oggi";

const dynamicFileName = `Report-Completo-${safePv}-${safeFrom}_${safeTo}.pdf`;

pdf.save(dynamicFileName);
}
