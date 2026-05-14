import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import JSZip from "jszip";
import { COOKIE_NAME, parseSessionValue } from "@/lib/auth";
import { parseBonificiXml } from "@/lib/bonifici/parseBonificiXml";
import { generateBonificoPdf } from "@/lib/bonifici/generateBonificoPdf";

export const runtime = "nodejs";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

function sanitizeFilename(value: string) {
  return String(value || "ricevuta")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function getZipName() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `ricevute-bonifici-${year}-${month}-${day}.zip`;
}

async function createZip(files: { filename: string; buffer: Buffer }[]) {
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.filename, file.buffer);
  }

  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
  });

  return Buffer.from(zipBuffer);
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);

    if (!session || session.role !== "admin") {
      return NextResponse.json({ ok: false, error: "Non autorizzato" }, { status: 401 });
    }

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "File XML mancante." },
        { status: 400 }
      );
    }

    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { ok: false, error: "File troppo grande. Limite massimo: 5MB." },
        { status: 400 }
      );
    }

    const lowerName = file.name.toLowerCase();
    const isXmlName = lowerName.endsWith(".xml") || lowerName.endsWith(".txt");
    const isXmlMime =
      file.type === "text/xml" ||
      file.type === "application/xml" ||
      file.type === "text/plain" ||
      file.type === "";

    if (!isXmlName && !isXmlMime) {
      return NextResponse.json(
        { ok: false, error: "Il file caricato non sembra un XML valido." },
        { status: 400 }
      );
    }

    const xml = await file.text();

    if (!xml.trim().startsWith("<?xml") && !xml.includes("<CBIDbtrPmtStatusReport")) {
      return NextResponse.json(
        { ok: false, error: "Contenuto XML non valido o non riconosciuto." },
        { status: 400 }
      );
    }

    const ricevute = parseBonificiXml(xml);

    const pdfFiles = await Promise.all(
      ricevute.map(async (ricevuta, index) => {
        const pdf = await generateBonificoPdf(ricevuta);
        const progressivo = String(index + 1).padStart(2, "0");
        const filename = `${progressivo}_${sanitizeFilename(ricevuta.nome)}.pdf`;

        return {
          filename,
          buffer: pdf,
        };
      })
    );

    const zipBuffer = await createZip(pdfFiles);
    const zipName = getZipName();

    return new NextResponse(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${zipName}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "Errore generazione ricevute bonifici.",
      },
      { status: 500 }
    );
  }
}