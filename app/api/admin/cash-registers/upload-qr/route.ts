import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { COOKIE_NAME, parseSessionValue } from '@/lib/auth';

import { supabaseAdmin } from '@/lib/supabaseAdmin';

const BUCKET = 'reorder-results';
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function detectImage(bytes: Uint8Array): { extension: 'png' | 'jpg'; contentType: string } | null {
  if (
    bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d &&
    bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return { extension: 'png', contentType: 'image/png' };
  if (
    bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[2] === 0xff && bytes[3] >= 0xc0
  ) return { extension: 'jpg', contentType: 'image/jpeg' };
  return null;
}

export async function POST(req: Request) {
  try {
    const session = parseSessionValue(cookies().get(COOKIE_NAME)?.value ?? null);
    if (!session) {
      return NextResponse.json({ error: 'Non autenticato' }, { status: 401 });
    }
    if (session.role !== 'admin') {
      return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 });
    }

    const formData = await req.formData();

    const idRaw = formData.get('id');
    const id = typeof idRaw === 'string' ? idRaw.trim() : '';
    const fileValue = formData.get('file');
    const file = fileValue instanceof File ? fileValue : null;

    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'ID cassa non valido' }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: 'File mancante' }, { status: 400 });
    }

    if (file.size === 0 || file.size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: 'Immagine vuota o superiore a 5 MB' }, { status: 400 });
    }

    // Non consentire di scrivere nello Storage con un ID inesistente.
    const { data: register, error: registerError } = await supabaseAdmin
      .from('cash_registers')
      .select('id')
      .eq('id', id)
      .maybeSingle();

    if (registerError) {
      return NextResponse.json({ error: 'Errore verifica cassa' }, { status: 500 });
    }
    if (!register) {
      return NextResponse.json({ error: 'Cassa non trovata' }, { status: 404 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = detectImage(bytes);
    if (!image) {
      return NextResponse.json({ error: 'Sono consentite soltanto immagini PNG o JPEG' }, { status: 400 });
    }

    // Il percorso non dipende dal nome del file caricato dall'utente.
    const filePath = `cash-registers/${id}.${image.extension}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, bytes, {
        contentType: image.contentType,
        upsert: true,
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Errore upload: ${uploadError.message}` },
        { status: 500 },
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('cash_registers')
      .update({
        qr_image_url: filePath,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: `Errore salvataggio DB: ${updateError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      item: updated,
      path: filePath,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore imprevisto';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}