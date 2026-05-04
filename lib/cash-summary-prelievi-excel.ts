import * as XLSX from "xlsx";

export type CashSummaryPrelieviExcelRow = {
  data: string;
  pv_label: string;
  spese_extra: number;
  note?: string;
};

export type GenerateCashSummaryPrelieviExcelReportArgs = {
  rows: CashSummaryPrelieviExcelRow[];
  pvLabel?: string;
  dateFrom?: string;
  dateTo?: string;
  fileName?: string;
};

function formatLongDate(value: string) {
  if (!value) return "";
  const [yyyy, mm, dd] = value.split("-");
  if (!yyyy || !mm || !dd) return value;
  return `${dd}/${mm}/${yyyy}`;
}

function safeFilePart(value: string) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^\w\-]/g, "");
}

function buildSafeFileName(pvLabel?: string, dateFrom?: string, dateTo?: string) {
  const safePv = safeFilePart(pvLabel || "Tutti") || "Tutti";
  const safeFrom = dateFrom || "inizio";
  const safeTo = dateTo || "oggi";

  return `Report-Prelievi-${safePv}-${safeFrom}_${safeTo}.xlsx`;
}

function n(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function applyStyles(ws: XLSX.WorkSheet, totalRows: number) {
  const euroCol = "C";

  for (let r = 2; r <= totalRows; r += 1) {
    const cell = ws[`${euroCol}${r}`];
    if (cell && typeof cell.v === "number") {
      cell.z = '[$€-it-IT] #,##0.00';
    }
  }

  ["A", "B", "C", "D"].forEach((col) => {
    const headerCell = ws[`${col}1`];
    if (headerCell) {
      headerCell.s = {
        ...(headerCell.s || {}),
        font: { bold: true },
      };
    }
  });
}

export function generateCashSummaryPrelieviExcelReport({
  rows,
  pvLabel,
  dateFrom,
  dateTo,
  fileName,
}: GenerateCashSummaryPrelieviExcelReportArgs) {
  const sortedRows = [...rows].sort((a, b) => {
    if (a.data !== b.data) return a.data.localeCompare(b.data);
    return a.pv_label.localeCompare(b.pv_label);
  });

  const header = [["Data", "PV", "Prelievo", "Note"]];

  const body = sortedRows.map((row) => [
    formatLongDate(String(row.data ?? "")),
    String(row.pv_label ?? ""),
    n(row.spese_extra),
    String(row.note ?? ""),
  ]);

  const ws = XLSX.utils.aoa_to_sheet([...header, ...body]);

  ws["!cols"] = [
    { wch: 12 }, // Data
    { wch: 28 }, // PV
    { wch: 16 }, // Prelievo
    { wch: 42 }, // Note
  ];

  applyStyles(ws, body.length + 1);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Prelievi");

  XLSX.writeFile(wb, fileName || buildSafeFileName(pvLabel, dateFrom, dateTo));
}
