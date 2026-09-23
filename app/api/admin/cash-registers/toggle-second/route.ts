import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const id = String(body?.id ?? '').trim();
    const pvId = String(body?.pv_id ?? '').trim();
    const enabled = Boolean(body?.enabled);

    let query = supabaseAdmin
      .from('cash_registers')
      .select('id, pv_id, label, is_enabled');

    if (id) {
      query = query.eq('id', id);
    } else if (pvId) {
      query = query
        .eq('pv_id', pvId)
        .eq('label', 'Cassa 2');
    } else {
      return NextResponse.json(
        { error: 'Cassa mancante' },
        { status: 400 },
      );
    }

    const { data: existing, error: existingError } =
      await query.maybeSingle();

    if (existingError) {
      return NextResponse.json(
        {
          error: `Errore verifica cassa: ${existingError.message}`,
        },
        { status: 500 },
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'Cassa non trovata' },
        { status: 404 },
      );
    }

    /*
     * Cassa 1 deve restare sempre attiva.
     */
    if (existing.label === 'Cassa 1' && !enabled) {
      return NextResponse.json(
        {
          error: 'Cassa 1 non può essere disattivata',
        },
        { status: 400 },
      );
    }

    const { data: updated, error: updateError } =
      await supabaseAdmin
        .from('cash_registers')
        .update({
          is_enabled: enabled,
        })
        .eq('id', existing.id)
        .select('*')
        .single();

    if (updateError) {
      return NextResponse.json(
        {
          error: `${
            enabled
              ? 'Errore attivazione'
              : 'Errore disattivazione'
          } cassa: ${updateError.message}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      item: updated,
      message: enabled
        ? `${updated.label} attivata con successo`
        : `${updated.label} disattivata con successo`,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Errore imprevisto';

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}