import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

type CreatePdfReportArgs = {
  title: string;
  subtitleLines?: string[];
  landscape?: boolean;
};

type TableRowOptions = {
  header?: boolean;
  fontSize?: number;
  lineHeight?: number;
};

const A4_PORTRAIT: [number, number] = [595.28, 841.89];
const A4_LANDSCAPE: [number, number] = [841.89, 595.28];

export function safePdfText(value: unknown) {
  return String(value ?? "")
    .replace(/[–—]/g, "-")
    .replace(/[•·]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "?")
    .trim();
}

export function safePdfFilePart(value: unknown) {
  return safePdfText(value)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_\-.]/g, "")
    .replace(/-+/g, "-")
    .slice(0, 80);
}

export class PdfReport {
  private doc: PDFDocument;
  private page: PDFPage;
  private font: PDFFont;
  private boldFont: PDFFont;
  private readonly pageSize: [number, number];
  private readonly margin = 36;
  private y: number;

  private constructor(doc: PDFDocument, page: PDFPage, font: PDFFont, boldFont: PDFFont, pageSize: [number, number]) {
    this.doc = doc;
    this.page = page;
    this.font = font;
    this.boldFont = boldFont;
    this.pageSize = pageSize;
    this.y = pageSize[1] - this.margin;
  }

  static async create(args: CreatePdfReportArgs) {
    const doc = await PDFDocument.create();
    const pageSize = args.landscape ? A4_LANDSCAPE : A4_PORTRAIT;
    const page = doc.addPage(pageSize);
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

    const report = new PdfReport(doc, page, font, boldFont, pageSize);
    report.title(args.title);
    for (const line of args.subtitleLines ?? []) {
      report.text(line, { size: 9, color: rgb(0.25, 0.3, 0.38) });
    }
    report.spacer(10);

    return report;
  }

  get contentWidth() {
    return this.pageSize[0] - this.margin * 2;
  }

  private addPage() {
    this.page = this.doc.addPage(this.pageSize);
    this.y = this.pageSize[1] - this.margin;
  }

  private ensureSpace(height: number) {
    if (this.y - height < this.margin) this.addPage();
  }

  title(value: unknown) {
    this.ensureSpace(28);
    this.page.drawText(safePdfText(value), {
      x: this.margin,
      y: this.y - 16,
      size: 16,
      font: this.boldFont,
      color: rgb(0.05, 0.08, 0.15),
    });
    this.y -= 24;
  }

  text(
    value: unknown,
    options?: {
      size?: number;
      font?: "regular" | "bold";
      color?: ReturnType<typeof rgb>;
    }
  ) {
    const size = options?.size ?? 10;
    this.ensureSpace(size + 6);
    this.page.drawText(safePdfText(value), {
      x: this.margin,
      y: this.y - size,
      size,
      font: options?.font === "bold" ? this.boldFont : this.font,
      color: options?.color ?? rgb(0.05, 0.08, 0.15),
    });
    this.y -= size + 5;
  }

  spacer(height = 8) {
    this.y -= height;
  }

  rule() {
    this.ensureSpace(8);
    this.page.drawLine({
      start: { x: this.margin, y: this.y },
      end: { x: this.pageSize[0] - this.margin, y: this.y },
      thickness: 0.7,
      color: rgb(0.75, 0.78, 0.82),
    });
    this.y -= 10;
  }

  private wrapText(text: string, width: number, font: PDFFont, size: number) {
    const clean = safePdfText(text);
    if (!clean) return [""];

    const paragraphs = clean.split(/\n+/);
    const lines: string[] = [];

    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let current = "";

      for (const word of words) {
        const candidate = current ? `${current} ${word}` : word;

        if (font.widthOfTextAtSize(candidate, size) <= width) {
          current = candidate;
          continue;
        }

        if (current) lines.push(current);

        if (font.widthOfTextAtSize(word, size) <= width) {
          current = word;
          continue;
        }

        let chunk = "";
        for (const char of word) {
          const next = `${chunk}${char}`;
          if (font.widthOfTextAtSize(next, size) <= width) {
            chunk = next;
          } else {
            if (chunk) lines.push(chunk);
            chunk = char;
          }
        }
        current = chunk;
      }

      if (current) lines.push(current);
      if (words.length === 0) lines.push("");
    }

    return lines.length ? lines : [""];
  }

  tableRow(cells: unknown[], widths: number[], options?: TableRowOptions) {
    const fontSize = options?.fontSize ?? 8;
    const lineHeight = options?.lineHeight ?? 10;
    const cellPaddingX = 4;
    const cellPaddingY = 5;
    const font = options?.header ? this.boldFont : this.font;

    const wrapped = cells.map((cell, index) =>
      this.wrapText(String(cell ?? ""), Math.max(1, widths[index] - cellPaddingX * 2), font, fontSize)
    );
    const maxLines = Math.max(...wrapped.map((lines) => lines.length), 1);
    const rowHeight = Math.max(22, cellPaddingY * 2 + maxLines * lineHeight);

    this.ensureSpace(rowHeight);

    let x = this.margin;
    for (let index = 0; index < cells.length; index += 1) {
      const width = widths[index];

      const rectangleOptions = {
        x,
        y: this.y - rowHeight,
        width,
        height: rowHeight,
        borderWidth: 0.6,
        borderColor: rgb(0.78, 0.8, 0.84),
        ...(options?.header ? { color: rgb(0.94, 0.95, 0.97) } : {}),
      };

      this.page.drawRectangle(rectangleOptions);

      let textY = this.y - cellPaddingY - fontSize;
      for (const line of wrapped[index]) {
        this.page.drawText(line, {
          x: x + cellPaddingX,
          y: textY,
          size: fontSize,
          font,
          color: rgb(0.08, 0.1, 0.16),
        });
        textY -= lineHeight;
      }

      x += width;
    }

    this.y -= rowHeight;
  }

  async save() {
    return this.doc.save();
  }
}
