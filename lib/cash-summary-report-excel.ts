import * as XLSX from "xlsx";

export type CashSummaryExcelReportRow = {
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

export type GenerateCashSummaryExcelReportArgs = {
  rows: CashSummaryExcelReportRow[];
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

function buildSafeFileName(pvLabel?: string, dateFrom?: string, dateTo?: string) {
  const safePv = String(pvLabel || "Tutti")
    .replace(/\s+/g, "")
    .replace(/[^\w\-]/g, "");

  const safeFrom = dateFrom || "inizio";
  const safeTo = dateTo || "oggi";

  return `Report-Completo-${safePv}-${safeFrom}_${safeTo}.xlsx`;
}

function sumBy<T>(rows: T[], getter: (row: T) => number) {
  return rows.reduce((sum, row) => sum + getter(row), 0);
}

function applyStyles(
  ws: XLSX.WorkSheet,
  headerRow: number,
  totalsRow: number,
  boldCols: string[],
  euroCols: string[]
) {
  for (let r = headerRow; r <= totalsRow; r += 1) {
    for (const col of euroCols) {
      const cellRef = `${col}${r + 1}`;
      const cell = ws[cellRef];
      if (cell && typeof cell.v === "number") {
        cell.z = '[$€-it-IT] #,##0.00';
      }
    }
  }

  for (const col of boldCols) {
    const headerCell = ws[`${col}${headerRow + 1}`];
    if (headerCell) {
      headerCell.s = {
        ...(headerCell.s || {}),
        font: { bold: true },
      };
    }

    const totalsCell = ws[`${col}${totalsRow + 1}`];
    if (totalsCell) {
      totalsCell.s = {
        ...(totalsCell.s || {}),
        font: { bold: true },
      };
    }
  }
}

export function generateCashSummaryExcelReport({
  rows,
  pvLabel,
  dateFrom,
  dateTo,
  fileName,
}: GenerateCashSummaryExcelReportArgs) {
  const sortedRows = [...rows].sort((a, b) => {
    if (a.data !== b.data) return a.data.localeCompare(b.data);
    return a.pv_label.localeCompare(b.pv_label);
  });

  const totals = {
    incasso_totale: sumBy(sortedRows, (r) => r.incasso_totale),
    gv_pagati: sumBy(sortedRows, (r) => r.gv_pagati),
    vendita_tabacchi: sumBy(sortedRows, (r) => r.vendita_tabacchi),
    vendita_gv: sumBy(sortedRows, (r) => r.vendita_gv),
    lis_plus: sumBy(sortedRows, (r) => r.lis_plus),
    mooney: sumBy(sortedRows, (r) => r.mooney),
  };

  // =========================
  // FOGLIO 1 — COMPLETO
  // =========================

  const header = [[
    "Data",
    "PV",
    "Operatore",
    "Incasso Totale",
    "Pagati G&V",
    "Tabacchi",
    "G&V",
    "LIS+",
    "Mooney",
  ]];

  const body = sortedRows.map((r) => [
    formatLongDate(r.data),
    r.pv_label,
    r.operatore,
    r.incasso_totale,
    r.gv_pagati,
    r.vendita_tabacchi,
    r.vendita_gv,
    r.lis_plus,
    r.mooney,
  ]);

  const totalsRow = [[
    "TOTALI",
    "",
    "",
    totals.incasso_totale,
    totals.gv_pagati,
    totals.vendita_tabacchi,
    totals.vendita_gv,
    totals.lis_plus,
    totals.mooney,
  ]];

  const ws = XLSX.utils.aoa_to_sheet([...header, ...body, ...totalsRow]);

  ws["!cols"] = [
    { wch: 12 }, // Data
    { wch: 24 }, // PV
    { wch: 20 }, // Operatore
    { wch: 16 }, // Incasso Totale
    { wch: 14 }, // Pagati G&V
    { wch: 16 }, // Tabacchi
    { wch: 14 }, // G&V
    { wch: 12 }, // LIS+
    { wch: 12 }, // Mooney
  ];

  applyStyles(
    ws,
    0,
    body.length + 1,
    ["A", "B", "C", "D", "E", "F", "G", "H", "I"],
    ["D", "E", "F", "G", "H", "I"]
  );

  // =========================
  // FOGLIO 2 — TOTALI GIORNALIERI
  // =========================

  const dailyMap = new Map<
    string,
    {
      data: string;
      incasso_totale: number;
      gv_pagati: number;
      vendita_tabacchi: number;
      vendita_gv: number;
      lis_plus: number;
      mooney: number;
    }
  >();

  sortedRows.forEach((r) => {
    const row = dailyMap.get(r.data) ?? {
      data: r.data,
      incasso_totale: 0,
      gv_pagati: 0,
      vendita_tabacchi: 0,
      vendita_gv: 0,
      lis_plus: 0,
      mooney: 0,
    };

    row.incasso_totale += r.incasso_totale;
    row.gv_pagati += r.gv_pagati;
    row.vendita_tabacchi += r.vendita_tabacchi;
    row.vendita_gv += r.vendita_gv;
    row.lis_plus += r.lis_plus;
    row.mooney += r.mooney;

    dailyMap.set(r.data, row);
  });

  const daily = Array.from(dailyMap.values()).sort((a, b) => a.data.localeCompare(b.data));

  const dailyHeader = [[
    "Data",
    "Incasso",
    "Pagati G&V",
    "Tabacchi",
    "G&V",
    "LIS+",
    "Mooney",
  ]];

  const dailyBody = daily.map((r) => [
    formatLongDate(r.data),
    r.incasso_totale,
    r.gv_pagati,
    r.vendita_tabacchi,
    r.vendita_gv,
    r.lis_plus,
    r.mooney,
  ]);

  const dailyTotalsRow = [[
    "TOTALI",
    totals.incasso_totale,
    totals.gv_pagati,
    totals.vendita_tabacchi,
    totals.vendita_gv,
    totals.lis_plus,
    totals.mooney,
  ]];

  const wsDaily = XLSX.utils.aoa_to_sheet([...dailyHeader, ...dailyBody, ...dailyTotalsRow]);

  wsDaily["!cols"] = [
    { wch: 12 }, // Data
    { wch: 16 }, // Incasso
    { wch: 14 }, // Pagati G&V
    { wch: 16 }, // Tabacchi
    { wch: 14 }, // G&V
    { wch: 12 }, // LIS+
    { wch: 12 }, // Mooney
  ];

  applyStyles(
    wsDaily,
    0,
    dailyBody.length + 1,
    ["A", "B", "C", "D", "E", "F", "G"],
    ["B", "C", "D", "E", "F", "G"]
  );

  // =========================
  // WORKBOOK
  // =========================

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report Completo");
  XLSX.utils.book_append_sheet(wb, wsDaily, "Totali Giornalieri");

  XLSX.writeFile(wb, fileName || buildSafeFileName(pvLabel, dateFrom, dateTo));
}
