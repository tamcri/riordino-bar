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

function formatDate(value: string) {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  const [yyyy, mm, dd] = raw.split("-");

  if (!yyyy || !mm || !dd) return raw;

  return `${dd}/${mm}/${yyyy}`;
}

function applyStyles(ws: XLSX.WorkSheet, totalRows: number) {
  const euroCol = "C";

  for (let r = 2; r <= totalRows; r += 1) {
    const cell = ws[`${euroCol}${r}`];

    if (cell && (typeof cell.v === "number" || cell.f)) {
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

  const totalLabelCell = ws[`A${totalRows}`];
  const totalValueCell = ws[`C${totalRows}`];

  if (totalLabelCell) {
    totalLabelCell.s = {
      ...(totalLabelCell.s || {}),
      font: { bold: true },
    };
  }

  if (totalValueCell) {
    totalValueCell.z = '[$€-it-IT] #,##0.00';
    totalValueCell.s = {
      ...(totalValueCell.s || {}),
      font: { bold: true },
    };
  }
}

export function generateCashSummaryPrelieviExcelReport({
  rows,
  pvLabel,
  dateFrom,
  dateTo,
  fileName,
}: GenerateCashSummaryPrelieviExcelReportArgs) {
  const sortedRows = [...rows]
    .filter((row) => n(row.spese_extra) > 0)
    .sort((a, b) => {
      const pvCompare = String(a.pv_label ?? "").localeCompare(
        String(b.pv_label ?? "")
      );

      if (pvCompare !== 0) return pvCompare;

      return String(a.data ?? "").localeCompare(String(b.data ?? ""));
    });

  const header = [["PV", "Data", "Prelievo", "Note"]];

  const body = sortedRows.map((row) => [
    String(row.pv_label ?? ""),
    formatDate(row.data),
    n(row.spese_extra),
    String(row.note ?? ""),
  ]);

  const lastDataRow = body.length + 1;
  const totalRowIndex = body.length + 2;

  const totalRow = [
    "TOTALE",
    "",
    {
      f: body.length > 0 ? `SUBTOTAL(109,C2:C${lastDataRow})` : "0",
      t: "n",
    },
    "",
  ];

  const ws = XLSX.utils.aoa_to_sheet([...header, ...body, totalRow]);

  ws["!cols"] = [
    { wch: 28 }, // PV
    { wch: 14 }, // Data
    { wch: 16 }, // Prelievo
    { wch: 42 }, // Note
  ];

  ws["!autofilter"] = {
    ref: `A1:D${totalRowIndex}`,
  };

  applyStyles(ws, totalRowIndex);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Prelievi");

  XLSX.writeFile(
    wb,
    fileName || buildSafeFileName(pvLabel, dateFrom, dateTo)
  );
}
