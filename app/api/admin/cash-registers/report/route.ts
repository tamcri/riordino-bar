import { rgb } from 'pdf-lib';
import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getCashRegisterAlert,
  getCashRegisterStatusLabel,
} from '@/lib/cash-registers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const EXCLUDED_PV_IDS = ['ed42ce52-a6bd-46cc-8609-9e5d1bb1f524'];

function shouldShowCashRegister(item: {
  label: string;
  is_enabled: boolean | null;
  qr_image_url: string | null;
  last_verification_date: string | null;
  next_verification_date: string | null;
}) {
  if (item.label === 'Cassa 1') return true;
  if (item.is_enabled) return true;

  return Boolean(
    item.qr_image_url ||
      item.last_verification_date ||
      item.next_verification_date,
  );
}

function formatDateIT(value: string | null | undefined) {
  if (!value) return '-';

  const parts = value.split('-');
  if (parts.length !== 3) return value;

  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function sanitizePdfText(value: string | null | undefined) {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

export async function GET() {
  try {
    const [{ data: pvs, error: pvsError }, { data: cashRegisters, error: cashRegistersError }] =
      await Promise.all([
        supabaseAdmin
          .from('pvs')
          .select('id, code, name')
          .order('code', { ascending: true }),
        supabaseAdmin
          .from('cash_registers')
          .select(
            'id, pv_id, label, identifier, qr_image_url, last_verification_date, next_verification_date, is_enabled, created_at, updated_at',
          )
          .order('pv_id', { ascending: true })
          .order('label', { ascending: true }),
      ]);

    if (pvsError) {
      return NextResponse.json(
        { error: `Errore lettura PV: ${pvsError.message}` },
        { status: 500 },
      );
    }

    if (cashRegistersError) {
      return NextResponse.json(
        { error: `Errore lettura casse: ${cashRegistersError.message}` },
        { status: 500 },
      );
    }

    const filteredPvs = (pvs ?? []).filter((pv) => !EXCLUDED_PV_IDS.includes(pv.id));

    const pvMap = new Map(
      filteredPvs.map((pv) => [
        pv.id,
        {
          code: pv.code ?? '',
          name: pv.name ?? '',
        },
      ]),
    );

    const rows = [...(cashRegisters ?? [])]
      .filter((item) => pvMap.has(item.pv_id))
      .filter((item) => shouldShowCashRegister(item))
      .sort((a, b) => {
        const pvA = pvMap.get(a.pv_id);
        const pvB = pvMap.get(b.pv_id);

        const codeA = pvA?.code ?? '';
        const codeB = pvB?.code ?? '';

        if (codeA !== codeB) {
          return codeA.localeCompare(codeB, 'it');
        }

        return a.label.localeCompare(b.label, 'it');
      })
      .map((item) => {
        const pv = pvMap.get(item.pv_id);

        return {
          pv_code: sanitizePdfText(pv?.code ?? ''),
          pv_name: sanitizePdfText(pv?.name ?? ''),
          label: sanitizePdfText(item.label),
          identifier: sanitizePdfText(item.identifier ?? '-'),
          last_verification_date: formatDateIT(item.last_verification_date),
          next_verification_date: formatDateIT(item.next_verification_date),
          status_label: sanitizePdfText(
            getCashRegisterStatusLabel(item.next_verification_date),
          ),
          alert: sanitizePdfText(getCashRegisterAlert(item.next_verification_date)),
        };
      });

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    let page = pdfDoc.addPage([842, 595]);
    let { width, height } = page.getSize();

    const margin = 32;
    const rowHeight = 22;
    const headerY = height - margin;

    const columns = [
      { key: 'pv', label: 'PV', x: 32, width: 150 },
      { key: 'cassa', label: 'Cassa', x: 182, width: 65 },
      { key: 'identificativo', label: 'Identificativo', x: 247, width: 120 },
      { key: 'ultima', label: 'Ultima', x: 367, width: 85 },
      { key: 'prossima', label: 'Prossima', x: 452, width: 85 },
      { key: 'stato', label: 'Stato', x: 537, width: 95 },
      { key: 'alert', label: 'Alert', x: 632, width: 178 },
    ] as const;

    function drawPageHeader(currentPage: typeof page, titleDate: string) {
      currentPage.drawText('Verifica Cassa - Report PDF', {
        x: margin,
        y: headerY,
        size: 16,
        font: fontBold,
      });

      currentPage.drawText(`Generato il ${titleDate}`, {
        x: margin,
        y: headerY - 18,
        size: 9,
        font,
      });

      const tableHeaderY = headerY - 46;

      currentPage.drawLine({
        start: { x: margin, y: tableHeaderY + 16 },
        end: { x: width - margin, y: tableHeaderY + 16 },
        thickness: 1,
      });

      columns.forEach((column) => {
        currentPage.drawText(column.label, {
          x: column.x,
          y: tableHeaderY,
          size: 9,
          font: fontBold,
        });
      });

      currentPage.drawLine({
        start: { x: margin, y: tableHeaderY - 6 },
        end: { x: width - margin, y: tableHeaderY - 6 },
        thickness: 1,
      });

      return tableHeaderY - 22;
    }

    const generatedAt = new Date().toLocaleString('it-IT');
    let y = drawPageHeader(page, generatedAt);

    for (const row of rows) {
  if (y < 50) {
    page = pdfDoc.addPage([842, 595]);
    ({ width, height } = page.getSize());
    y = drawPageHeader(page, generatedAt);
  }

  const pvText = truncate(`${row.pv_code} - ${row.pv_name}`, 28);
  const cassaText = truncate(row.label, 10);
  const identifierText = truncate(row.identifier || '-', 18);
  const ultimaText = truncate(row.last_verification_date, 12);
  const prossimaText = truncate(row.next_verification_date, 12);
  const statoText = truncate(row.status_label, 18);
  const alertText = truncate(row.alert, 30);

  // 🔥 SE SCADUTA → SFONDO ROSSO
  if (row.status_label === 'Scaduta') {
    page.drawRectangle({
      x: margin,
      y: y - 6,
      width: width - margin * 2,
      height: rowHeight,
      color: rgb(1, 0.9, 0.9), // rosso chiaro
    });
  }

  page.drawText(pvText, {
    x: columns[0].x,
    y,
    size: 9,
    font,
  });

  page.drawText(cassaText, {
    x: columns[1].x,
    y,
    size: 9,
    font,
  });

  page.drawText(identifierText, {
    x: columns[2].x,
    y,
    size: 9,
    font,
  });

  page.drawText(ultimaText, {
    x: columns[3].x,
    y,
    size: 9,
    font,
  });

  page.drawText(prossimaText, {
    x: columns[4].x,
    y,
    size: 9,
    font,
  });

  page.drawText(statoText, {
    x: columns[5].x,
    y,
    size: 9,
    font,
  });

  page.drawText(alertText, {
    x: columns[6].x,
    y,
    size: 9,
    font,
  });

  page.drawLine({
    start: { x: margin, y: y - 6 },
    end: { x: width - margin, y: y - 6 },
    thickness: 0.5,
  });

  y -= rowHeight;
}

    const pdfBytes = await pdfDoc.save();

    return new NextResponse(Buffer.from(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="verifica-cassa-report.pdf"',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore imprevisto';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}