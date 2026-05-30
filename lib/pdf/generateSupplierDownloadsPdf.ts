import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export type SupplierDownloadsPdfRow = {
  id: string;
  summary_id: string;
  date: string;
  pv_id: string;
  pv_code: string;
  pv_name: string;
  supplier_code: string;
  supplier_name: string;
  amount: number;
  summary_status: string;
  is_closed: boolean;
  created_at?: string;
};

export type SupplierDownloadsPdfRecurringRow = {
  key: string;
  supplier_code: string;
  supplier_name: string;
  pv_id: string;
  pv_label: string;
  count: number;
  total_amount: number;
  average_amount: number;
  first_date: string;
  last_date: string;
  is_anomaly: boolean;
};

export type SupplierDownloadsPdfStats = {
  totalDownloads: number;
  totalAmount: number;
  distinctSuppliers: number;
  topSupplier: { label: string; count: number } | null;
  topPv: { label: string; count: number } | null;
};

export type SupplierDownloadsPdfFilters = {
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
  pvLabel: string;
  supplier: string;
  anomalyThresholdLabel: string;
};

export function generateSupplierDownloadsPdf({
  rows,
  recurringSuppliers,
  stats,
  filters,
}: {
  rows: SupplierDownloadsPdfRow[];
  recurringSuppliers: SupplierDownloadsPdfRecurringRow[];
  stats: SupplierDownloadsPdfStats;
  filters: SupplierDownloadsPdfFilters;
}) {
  const pdf = new jsPDF({ orientation: "l", unit: "mm", format: "a4" });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 8;
  const contentWidth = pageWidth - margin * 2;
  const generatedAt = new Date().toLocaleString("it-IT");

  let y = 9;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Report Scarichi Fornitori", margin, y);

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
    head: [["Filtro", "Valore", "Filtro", "Valore"]],
    body: [
      [
        "Periodo",
        filters.periodLabel || "—",
        "Date",
        `${formatDate(filters.dateFrom)} - ${formatDate(filters.dateTo)}`,
      ],
      [
        "PV",
        filters.pvLabel || "Tutti i PV",
        "Fornitore",
        filters.supplier || "Tutti i fornitori",
      ],
    ],
    styles: compactStyle(),
    headStyles: darkHeadStyle(),
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: "bold" },
      1: { cellWidth: 95 },
      2: { cellWidth: 28, fontStyle: "bold" },
      3: { cellWidth: contentWidth - 151 },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 5;

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [
      [
        "Totale scarichi",
        "Totale importi",
        "Fornitori diversi",
        "Fornitore più frequente",
        "PV con più scarichi",
      ],
    ],
    body: [
      [
        String(stats.totalDownloads ?? 0),
        formatEuro(stats.totalAmount),
        String(stats.distinctSuppliers ?? 0),
        stats.topSupplier
          ? `${stats.topSupplier.label} (${stats.topSupplier.count})`
          : "—",
        stats.topPv ? `${stats.topPv.label} (${stats.topPv.count})` : "—",
      ],
    ],
    styles: compactStyle(),
    headStyles: blueHeadStyle(),
    bodyStyles: { textColor: [15, 23, 42], fontStyle: "bold" },
    columnStyles: {
      0: { cellWidth: 35, halign: "center" },
      1: { cellWidth: 40, halign: "right" },
      2: { cellWidth: 38, halign: "center" },
      3: { cellWidth: 88 },
      4: { cellWidth: contentWidth - 201 },
    },
    margin: { left: margin, right: margin },
  });

  y = getFinalY(pdf) + 6;

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Scarichi registrati", margin, y);

  y += 2;

  const downloadRows =
    rows.length > 0
      ? rows.map((row) => [
          formatDate(row.date),
          formatPvLabel(row),
          row.supplier_code || "—",
          row.supplier_name || "—",
          formatEuro(row.amount),
          row.is_closed ? "Chiuso" : "Aperto",
        ])
      : [["—", "—", "—", "Nessuno scarico fornitore trovato", "—", "—"]];

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [["Data", "PV", "Codice", "Ragione sociale", "Importo", "Stato"]],
    body: downloadRows,
    styles: tableStyle(),
    headStyles: blueHeadStyle(),
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      0: { cellWidth: 24 },
      1: { cellWidth: 54 },
      2: { cellWidth: 30 },
      3: { cellWidth: contentWidth - 182 },
      4: { cellWidth: 42, halign: "right" },
      5: { cellWidth: 32, halign: "center" },
    },
    margin: { left: margin, right: margin },
    didDrawPage: () => drawFooter(pdf, pageWidth, pageHeight, margin),
  });

  y = getFinalY(pdf) + 7;

  if (y > pageHeight - 55) {
    pdf.addPage();
    y = 10;
  }

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.setTextColor(15, 23, 42);
  pdf.text("Fornitori ricorrenti", margin, y);

  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(71, 85, 105);
  pdf.text(`Soglia anomalia: ${filters.anomalyThresholdLabel || "—"}`, pageWidth - margin, y, {
    align: "right",
  });

  y += 2;

  const recurringRows =
    recurringSuppliers.length > 0
      ? recurringSuppliers.map((row) => [
          `${row.supplier_name || "Fornitore non indicato"}\n${
            row.supplier_code || "Codice non indicato"
          }`,
          row.pv_label || "PV",
          String(row.count),
          formatEuro(row.total_amount),
          formatEuro(row.average_amount),
          formatDate(row.first_date),
          formatDate(row.last_date),
          row.is_anomaly ? "Da controllare" : "Normale",
        ])
      : [["Nessun fornitore ricorrente", "—", "—", "—", "—", "—", "—", "—"]];

  autoTable(pdf, {
    startY: y,
    theme: "grid",
    head: [
      [
        "Fornitore",
        "PV",
        "N. scarichi",
        "Totale",
        "Media",
        "Prima data",
        "Ultima data",
        "Anomalia",
      ],
    ],
    body: recurringRows,
    styles: tableStyle(),
    headStyles: blueHeadStyle(),
    bodyStyles: { textColor: [51, 65, 85] },
    columnStyles: {
      0: { cellWidth: 70 },
      1: { cellWidth: 48 },
      2: { cellWidth: 25, halign: "right" },
      3: { cellWidth: 34, halign: "right" },
      4: { cellWidth: 34, halign: "right" },
      5: { cellWidth: 26 },
      6: { cellWidth: 26 },
      7: { cellWidth: contentWidth - 263, halign: "center" },
    },
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
  if (data.section !== "body") return;

  const raw = Array.isArray(data.row.raw) ? data.row.raw : [];
  const anomalyValue = String(raw[7] ?? "");

  if (anomalyValue === "Da controllare") {
    data.cell.styles.fillColor = [254, 242, 242];
    data.cell.styles.textColor = [153, 27, 27];
  }
},
    didDrawPage: () => drawFooter(pdf, pageWidth, pageHeight, margin),
  });

  drawFooter(pdf, pageWidth, pageHeight, margin);

  const fileName = `Scarichi-Fornitori-${safeFileName(
    filters.dateFrom || "inizio"
  )}-${safeFileName(filters.dateTo || "fine")}.pdf`;

  pdf.save(fileName);
}

function compactStyle() {
  return {
    font: "helvetica",
    fontSize: 8,
    cellPadding: { top: 1.4, right: 1.5, bottom: 1.4, left: 1.5 },
    lineWidth: 0.1,
    overflow: "linebreak" as const,
  };
}

function tableStyle() {
  return {
    font: "helvetica",
    fontSize: 7,
    cellPadding: { top: 1.2, right: 1.4, bottom: 1.2, left: 1.4 },
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

function drawFooter(
  pdf: jsPDF,
  pageWidth: number,
  pageHeight: number,
  margin: number
) {
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(100, 116, 139);
  pdf.text(
    `Pagina ${pdf.getCurrentPageInfo().pageNumber} di ${pdf.getNumberOfPages()}`,
    pageWidth - margin,
    pageHeight - 5,
    { align: "right" }
  );
}

function getFinalY(pdf: jsPDF) {
  return (pdf as any).lastAutoTable?.finalY ?? 20;
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

function formatPvLabel(
  row: Pick<SupplierDownloadsPdfRow, "pv_code" | "pv_name">
) {
  const code = String(row.pv_code ?? "").trim();
  const name = String(row.pv_name ?? "").trim();

  if (code && name) return `${code} — ${name}`;
  if (name) return name;
  if (code) return code;

  return "PV";
}

function safeFileName(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w\-]/g, "");
}