// File: lib/pdf/fillU88FromImage.ts
import { PDFDocument, StandardFonts } from "pdf-lib";
import { pxToPt, type U88PageLayout } from "./u88Layout";

export type U88Item = {
  descrizione: string;        // serve SOLO per match (come già fai)
  pesoKg: number;             // es 7.2
  valoreDaOrdinare: number;   // importo
};

function moneyIT(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  return new Intl.NumberFormat("it-IT", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function splitKgGr(pesoKg: number): { kgText: string; grText: string } {
  const safeKg = Math.max(0, Number.isFinite(pesoKg) ? pesoKg : 0);

  let kgInt = 0;
  let grInt = 0;

  if (safeKg >= 1) {
    kgInt = Math.floor(safeKg);
    const remainder = safeKg - kgInt;
    grInt = Math.round(remainder * 1000);

    if (grInt >= 1000) {
      kgInt += 1;
      grInt = 0;
    }
  } else {
    grInt = Math.round(safeKg * 1000);
  }

  return {
    kgText: kgInt > 0 ? String(kgInt) : "",
    grText: grInt > 0 ? String(grInt) : "",
  };
}

/**
 * Converte una Y "da top" (pixel) in Y pdf-lib "da bottom" (points)
 */
function yTopPxToPdfPt(yFromTopPx: number, imageHeightPx: number) {
  const yFromBottomPx = imageHeightPx - yFromTopPx;
  return pxToPt(yFromBottomPx);
}

/**
 * Disegna griglia + numeri riga per tarare layout.
 * Produci un PDF di debug e lo apri: vedi subito dove cascano le righe/colonne.
 */
export async function debugU88LayoutPdf(
  pagePngBytes: Uint8Array,
  layout: U88PageLayout
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage();

  const png = await pdfDoc.embedPng(pagePngBytes);

  // dimensione pagina = dimensione immagine in points
  const pageW = pxToPt(png.width);
  const pageH = pxToPt(png.height);
  page.setSize(pageW, pageH);

  page.drawImage(png, { x: 0, y: 0, width: pageW, height: pageH });

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontSize = 10;

  // linee orizzontali righe
  for (let i = 0; i < layout.rows; i++) {
    const yTopPx = layout.firstRowYPx + i * layout.rowHeightPx;
    const y = yTopPxToPdfPt(yTopPx, layout.imageHeightPx);

    // piccola etichetta riga
    page.drawText(String(i + 1), {
      x: pxToPt(40),
      y: y + pxToPt(4),
      size: fontSize,
      font,
    });

    // linea orizzontale
    page.drawLine({
      start: { x: pxToPt(20), y },
      end: { x: pageW - pxToPt(20), y },
      thickness: 0.5,
    });
  }

  // linee verticali colonne (kg/gr/imp sx e dx)
  const xs = [
    layout.left.kgXPx,
    layout.left.grXPx,
    layout.left.impXPx,
    layout.right.kgXPx,
    layout.right.grXPx,
    layout.right.impXPx,
  ];

  for (const xPx of xs) {
    const x = pxToPt(xPx);
    page.drawLine({
      start: { x, y: pxToPt(50) },
      end: { x, y: pageH - pxToPt(50) },
      thickness: 0.5,
    });
  }

  return await pdfDoc.save({ useObjectStreams: false });
}

/**
 * Compila U88 usando:
 * - sfondo immagine (PNG di UNA pagina)
 * - coordinate layout
 * - items già matchati e ordinati in ordine di riga
 *
 * Qui do per scontato che TU hai già fatto il match descrizione->riga e
 * mi passi items nell'ordine esatto in cui vanno scritti sul modulo.
 */
export async function fillU88FromImage(
  pagePngBytes: Uint8Array,
  layouts: U88PageLayout[],
  itemsOrdered: U88Item[]
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const png = await pdfDoc.embedPng(pagePngBytes);

  // Dimensioni pagina (da immagine)
  const pageW = pxToPt(png.width);
  const pageH = pxToPt(png.height);

  const fontSize = 10;

  // quante righe per pagina (2 colonne)
  const rowsPerPage = layouts[0]?.rows ?? 61;
  const capacityPerPage = rowsPerPage * 2;

  let idx = 0;

  for (const layout of layouts) {
    const page = pdfDoc.addPage([pageW, pageH]);
    page.drawImage(png, { x: 0, y: 0, width: pageW, height: pageH });

    for (let r = 0; r < rowsPerPage; r++) {
      // colonna sinistra
      const itemL = itemsOrdered[idx++];
      if (itemL) {
        const yTopPx = layout.firstRowYPx + r * layout.rowHeightPx;
        const y = yTopPxToPdfPt(yTopPx, layout.imageHeightPx);

        const { kgText, grText } = splitKgGr(itemL.pesoKg);
        const impText = moneyIT(itemL.valoreDaOrdinare);

        if (kgText) page.drawText(kgText, { x: pxToPt(layout.left.kgXPx), y, size: fontSize, font });
        if (grText) page.drawText(grText, { x: pxToPt(layout.left.grXPx), y, size: fontSize, font });
        if (impText) page.drawText(impText, { x: pxToPt(layout.left.impXPx), y, size: fontSize, font });
      }

      // colonna destra
      const itemR = itemsOrdered[idx++];
      if (itemR) {
        const yTopPx = layout.firstRowYPx + r * layout.rowHeightPx;
        const y = yTopPxToPdfPt(yTopPx, layout.imageHeightPx);

        const { kgText, grText } = splitKgGr(itemR.pesoKg);
        const impText = moneyIT(itemR.valoreDaOrdinare);

        if (kgText) page.drawText(kgText, { x: pxToPt(layout.right.kgXPx), y, size: fontSize, font });
        if (grText) page.drawText(grText, { x: pxToPt(layout.right.grXPx), y, size: fontSize, font });
        if (impText) page.drawText(impText, { x: pxToPt(layout.right.impXPx), y, size: fontSize, font });
      }

      // se finiti gli items, possiamo uscire “puliti”
      if (idx >= itemsOrdered.length) break;
    }

    if (idx >= itemsOrdered.length) break;
  }

  return await pdfDoc.save({ useObjectStreams: false });
}
