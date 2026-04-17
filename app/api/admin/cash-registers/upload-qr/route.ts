import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const BUCKET = 'reorder-results';

export async function POST(req: Request) {
  try {
    const formData = await req.formData();

    const id = formData.get('id') as string | null;
    const file = formData.get('file') as File | null;

    if (!id) {
      return NextResponse.json({ error: 'ID mancante' }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({ error: 'File mancante' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    const extension =
      file.name.split('.').pop()?.toLowerCase() ||
      file.type.split('/').pop()?.toLowerCase() ||
      'png';

    const filePath = `cash-registers/${id}.${extension}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, bytes, {
        contentType: file.type || 'image/png',
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