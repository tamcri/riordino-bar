import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pvId = String(body?.pv_id ?? '').trim();
    const enabled = Boolean(body?.enabled);

    if (!pvId) {
      return NextResponse.json({ error: 'PV mancante' }, { status: 400 });
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('cash_registers')
      .select('id, pv_id, label, is_enabled')
      .eq('pv_id', pvId)
      .eq('label', 'Cassa 2')
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { error: `Errore verifica Cassa 2: ${existingError.message}` },
        { status: 500 },
      );
    }

    if (!existing) {
      return NextResponse.json(
        { error: 'Cassa 2 non trovata per questo PV' },
        { status: 404 },
      );
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('cash_registers')
      .update({ is_enabled: enabled })
      .eq('id', existing.id)
      .select('*')
      .single();

    if (updateError) {
      return NextResponse.json(
        {
          error: `${enabled ? 'Errore attivazione' : 'Errore disattivazione'} Cassa 2: ${updateError.message}`,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      item: updated,
      message: enabled
        ? 'Cassa 2 attivata con successo'
        : 'Cassa 2 disattivata con successo',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore imprevisto';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}