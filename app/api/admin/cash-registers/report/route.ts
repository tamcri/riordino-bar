import { NextResponse } from 'next/server';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  PDFImage,
} from 'pdf-lib';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

import {
  getCashRegisterAlert,
  getCashRegisterStatusLabel,
} from '@/lib/cash-registers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const EXCLUDED_PV_IDS = [
  'ed42ce52-a6bd-46cc-8609-9e5d1bb1f524',
];

const STORAGE_BUCKET = 'reorder-results';

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

function formatDateIT(
  value: string | null | undefined,
) {
  if (!value) return '-';

  const parts = value.split('-');

  if (parts.length !== 3) {
    return value;
  }

  const [year, month, day] = parts;

  return `${day}/${month}/${year}`;
}

function sanitizePdfText(
  value: string | null | undefined,
) {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(
  value: string,
  maxLength: number,
) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

async function embedQrImage(
  pdfDoc: PDFDocument,
  path: string | null,
): Promise<PDFImage | null> {
  if (!path) return null;

  try {
    const { data, error } =
      await supabaseAdmin.storage
        .from(STORAGE_BUCKET)
        .download(path);

    if (error || !data) {
      console.error(
        `Errore download QR ${path}:`,
        error?.message,
      );

      return null;
    }

    const bytes = new Uint8Array(
      await data.arrayBuffer(),
    );

    const contentType =
      data.type?.toLowerCase() ?? '';

    const lowerPath =
      path.toLowerCase();

    if (
      contentType.includes('png') ||
      lowerPath.endsWith('.png')
    ) {
      return await pdfDoc.embedPng(bytes);
    }

    if (
      contentType.includes('jpeg') ||
      contentType.includes('jpg') ||
      lowerPath.endsWith('.jpg') ||
      lowerPath.endsWith('.jpeg')
    ) {
      return await pdfDoc.embedJpg(bytes);
    }

    console.warn(
      `Formato QR non supportato nel PDF: ${path}`,
    );

    return null;
  } catch (error) {
    console.error(
      `Errore incorporamento QR ${path}:`,
      error,
    );

    return null;
  }
}

export async function GET() {
  try {
    const [
      {
        data: pvs,
        error: pvsError,
      },
      {
        data: cashRegisters,
        error: cashRegistersError,
      },
    ] = await Promise.all([
      supabaseAdmin
        .from('pvs')
        .select('id, code, name')
        .order('code', {
          ascending: true,
        }),

      supabaseAdmin
        .from('cash_registers')
        .select(
          `
            id,
            pv_id,
            label,
            identifier,
            qr_image_url,
            last_verification_date,
            next_verification_date,
            is_enabled,
            created_at,
            updated_at
          `,
        )
        .order('pv_id', {
          ascending: true,
        })
        .order('label', {
          ascending: true,
        }),
    ]);

    if (pvsError) {
      return NextResponse.json(
        {
          error: `Errore lettura PV: ${pvsError.message}`,
        },
        {
          status: 500,
        },
      );
    }

    if (cashRegistersError) {
      return NextResponse.json(
        {
          error: `Errore lettura casse: ${cashRegistersError.message}`,
        },
        {
          status: 500,
        },
      );
    }

    const filteredPvs =
      (pvs ?? []).filter(
        (pv) =>
          !EXCLUDED_PV_IDS.includes(pv.id),
      );

    const pvMap = new Map(
      filteredPvs.map((pv) => [
        pv.id,
        {
          code: pv.code ?? '',
          name: pv.name ?? '',
        },
      ]),
    );

    const rows =
      [...(cashRegisters ?? [])]
        .filter((item) =>
          pvMap.has(item.pv_id),
        )
        .filter((item) =>
          shouldShowCashRegister(item),
        )
        .sort((a, b) => {
          const pvA =
            pvMap.get(a.pv_id);

          const pvB =
            pvMap.get(b.pv_id);

          const codeA =
            pvA?.code ?? '';

          const codeB =
            pvB?.code ?? '';

          if (codeA !== codeB) {
            return codeA.localeCompare(
              codeB,
              'it',
            );
          }

          const numberA =
            Number(
              a.label.match(/\d+/)?.[0] ??
                0,
            );

          const numberB =
            Number(
              b.label.match(/\d+/)?.[0] ??
                0,
            );

          return numberA - numberB;
        })
        .map((item) => {
          const pv =
            pvMap.get(item.pv_id);

          return {
            pv_code:
              sanitizePdfText(
                pv?.code ?? '',
              ),

            pv_name:
              sanitizePdfText(
                pv?.name ?? '',
              ),

            label:
              sanitizePdfText(
                item.label,
              ),

            identifier:
              sanitizePdfText(
                item.identifier ?? '-',
              ),

            qr_image_path:
              item.qr_image_url,

            last_verification_date:
              formatDateIT(
                item.last_verification_date,
              ),

            next_verification_date:
              formatDateIT(
                item.next_verification_date,
              ),

            status_label:
              sanitizePdfText(
                getCashRegisterStatusLabel(
                  item.next_verification_date,
                ),
              ),

            alert:
              sanitizePdfText(
                getCashRegisterAlert(
                  item.next_verification_date,
                ),
              ),
          };
        });

    const pdfDoc =
      await PDFDocument.create();

    const font =
      await pdfDoc.embedFont(
        StandardFonts.Helvetica,
      );

    const fontBold =
      await pdfDoc.embedFont(
        StandardFonts.HelveticaBold,
      );

    /*
     * Prepariamo prima le immagini QR.
     * Così durante il disegno del PDF
     * sono già disponibili.
     */
    const rowsWithQr =
      await Promise.all(
        rows.map(async (row) => ({
          ...row,

          qrImage:
            await embedQrImage(
              pdfDoc,
              row.qr_image_path,
            ),
        })),
      );

    /*
     * A4 landscape.
     */
    let page =
      pdfDoc.addPage([
        842,
        595,
      ]);

    let {
      width,
      height,
    } = page.getSize();

    const margin = 28;

    /*
     * La riga è più alta rispetto al vecchio
     * report perché ora dobbiamo ospitare il QR.
     */
    const rowHeight = 54;

    const qrSize = 42;

    const headerY =
      height - margin;

    const columns = [
      {
        key: 'pv',
        label: 'PV',
        x: 28,
        width: 132,
      },

      {
        key: 'cassa',
        label: 'Cassa',
        x: 160,
        width: 55,
      },

      {
        key: 'identifier',
        label: 'Identificativo',
        x: 215,
        width: 100,
      },

      {
        key: 'qr',
        label: 'QR',
        x: 315,
        width: 55,
      },

      {
        key: 'ultima',
        label: 'Ultima',
        x: 370,
        width: 82,
      },

      {
        key: 'prossima',
        label: 'Prossima',
        x: 452,
        width: 82,
      },

      {
        key: 'stato',
        label: 'Stato',
        x: 534,
        width: 110,
      },

      {
        key: 'alert',
        label: 'Alert',
        x: 644,
        width: 165,
      },
    ] as const;

    function drawPageHeader(
      currentPage:
        typeof page,
      titleDate: string,
    ) {
      currentPage.drawText(
        'Verifica Cassa - Report PDF',
        {
          x: margin,
          y: headerY,
          size: 16,
          font: fontBold,
        },
      );

      currentPage.drawText(
        `Generato il ${titleDate}`,
        {
          x: margin,
          y: headerY - 18,
          size: 9,
          font,
        },
      );

      const tableHeaderY =
        headerY - 46;

      currentPage.drawLine({
        start: {
          x: margin,
          y: tableHeaderY + 16,
        },

        end: {
          x: width - margin,
          y: tableHeaderY + 16,
        },

        thickness: 1,
      });

      columns.forEach(
        (column) => {
          currentPage.drawText(
            column.label,
            {
              x: column.x,
              y: tableHeaderY,
              size: 8.5,
              font: fontBold,
            },
          );
        },
      );

      currentPage.drawLine({
        start: {
          x: margin,
          y: tableHeaderY - 6,
        },

        end: {
          x: width - margin,
          y: tableHeaderY - 6,
        },

        thickness: 1,
      });

      return (
        tableHeaderY -
        rowHeight
      );
    }

    const generatedAt =
      new Date().toLocaleString(
        'it-IT',
      );

    let y =
      drawPageHeader(
        page,
        generatedAt,
      );

    for (
      const row of rowsWithQr
    ) {
      if (
        y <
        margin + 10
      ) {
        page =
          pdfDoc.addPage([
            842,
            595,
          ]);

        ({
          width,
          height,
        } = page.getSize());

        y =
          drawPageHeader(
            page,
            generatedAt,
          );
      }

      const rowBottom =
        y - 8;

      /*
       * Se la cassa è scaduta,
       * manteniamo l'evidenziazione rossa.
       */
      if (
        row.status_label ===
        'Scaduta'
      ) {
        page.drawRectangle({
          x: margin,
          y: rowBottom,
          width:
            width -
            margin * 2,
          height:
            rowHeight - 2,
          color: rgb(
            1,
            0.9,
            0.9,
          ),
        });
      }

      const textY =
        y +
        rowHeight / 2 -
        24;

      const pvText =
        truncate(
          `${row.pv_code} - ${row.pv_name}`,
          23,
        );

      const cassaText =
        truncate(
          row.label,
          10,
        );

      const identifierText =
        truncate(
          row.identifier ||
            '-',
          15,
        );

      const ultimaText =
        truncate(
          row.last_verification_date,
          12,
        );

      const prossimaText =
        truncate(
          row.next_verification_date,
          12,
        );

      const statoText =
        truncate(
          row.status_label,
          20,
        );

      const alertText =
        truncate(
          row.alert,
          27,
        );

      page.drawText(
        pvText,
        {
          x: columns[0].x,
          y: textY,
          size: 8.5,
          font,
        },
      );

      page.drawText(
        cassaText,
        {
          x: columns[1].x,
          y: textY,
          size: 8.5,
          font,
        },
      );

      page.drawText(
        identifierText,
        {
          x: columns[2].x,
          y: textY,
          size: 8.5,
          font,
        },
      );

      /*
       * Disegno QR.
       */
      if (row.qrImage) {
        const dimensions =
          row.qrImage.scale(1);

        const maxDimension =
          Math.max(
            dimensions.width,
            dimensions.height,
          );

        const scale =
          qrSize /
          maxDimension;

        const imageWidth =
          dimensions.width *
          scale;

        const imageHeight =
          dimensions.height *
          scale;

        page.drawImage(
          row.qrImage,
          {
            x:
              columns[3].x +
              (qrSize -
                imageWidth) /
                2,

            y:
              rowBottom +
              (
                rowHeight -
                imageHeight
              ) /
                2,

            width:
              imageWidth,

            height:
              imageHeight,
          },
        );
      } else {
        page.drawText(
          '-',
          {
            x:
              columns[3].x +
              18,

            y:
              textY,

            size: 9,
            font,
          },
        );
      }

      page.drawText(
        ultimaText,
        {
          x: columns[4].x,
          y: textY,
          size: 8.5,
          font,
        },
      );

      page.drawText(
        prossimaText,
        {
          x: columns[5].x,
          y: textY,
          size: 8.5,
          font,
        },
      );

      page.drawText(
        statoText,
        {
          x: columns[6].x,
          y: textY,
          size: 8.5,
          font,
        },
      );

      page.drawText(
        alertText,
        {
          x: columns[7].x,
          y: textY,
          size: 8.5,
          font,
        },
      );

      page.drawLine({
        start: {
          x: margin,
          y: rowBottom,
        },

        end: {
          x:
            width -
            margin,
          y: rowBottom,
        },

        thickness: 0.5,

        color: rgb(
          0.75,
          0.75,
          0.75,
        ),
      });

      y -= rowHeight;
    }

    const pdfBytes =
      await pdfDoc.save();

    return new NextResponse(
      Buffer.from(
        pdfBytes,
      ),
      {
        status: 200,

        headers: {
          'Content-Type':
            'application/pdf',

          'Content-Disposition':
            'attachment; filename="verifica-cassa-report.pdf"',

          'Cache-Control':
            'no-store',
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto';

    console.error(
      'Errore generazione report Verifica Cassa:',
      error,
    );

    return NextResponse.json(
      {
        error: message,
      },
      {
        status: 500,
      },
    );
  }
}