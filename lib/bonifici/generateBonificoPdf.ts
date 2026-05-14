import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { BonificoRicevuta } from "./parseBonificiXml";

function formatEuro(value: number, valuta: string) {
  return new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: valuta || "EUR",
  }).format(value);
}

function formatDateIT(value: string) {
  const parts = value.split("-");
  if (parts.length !== 3) return value;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

function sanitizePdfText(value: string | null | undefined) {
  if (!value) return "-";

  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function generateBonificoPdf(ricevuta: BonificoRicevuta) {
  const pdfDoc = await PDFDocument.create();

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([595, 842]);
  const { width, height } = page.getSize();

  const margin = 50;
  let y = height - margin;

  page.drawText(sanitizePdfText(ricevuta.azienda || "Azienda"), {
    x: margin,
    y,
    size: 16,
    font: fontBold,
    color: rgb(0.08, 0.12, 0.2),
  });

  y -= 42;

  page.drawText("RICEVUTA BONIFICO", {
    x: margin,
    y,
    size: 20,
    font: fontBold,
    color: rgb(0.08, 0.12, 0.2),
  });

  y -= 35;

  page.drawLine({
    start: { x: margin, y },
    end: { x: width - margin, y },
    thickness: 1,
    color: rgb(0.75, 0.78, 0.82),
  });

  y -= 42;

  const rows = [
    ["Dipendente", ricevuta.nome],
    ["Importo", formatEuro(ricevuta.importo, ricevuta.valuta)],
    ["Data accredito", formatDateIT(ricevuta.dataAccredito)],
    ["Causale", ricevuta.causale],
    ["Stato pagamento", ricevuta.stato],
    ["Riferimento", ricevuta.riferimento],
  ];

  for (const [label, value] of rows) {
    page.drawText(label, {
      x: margin,
      y,
      size: 11,
      font: fontBold,
      color: rgb(0.22, 0.27, 0.35),
    });

    page.drawText(sanitizePdfText(value), {
      x: margin + 140,
      y,
      size: 11,
      font,
      color: rgb(0.08, 0.12, 0.2),
    });

    y -= 28;
  }

  y -= 20;

  page.drawText("Documento generato automaticamente da file XML bancario.", {
    x: margin,
    y,
    size: 9,
    font,
    color: rgb(0.42, 0.46, 0.53),
  });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}