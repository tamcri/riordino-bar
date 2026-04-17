import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { calculateNextVerificationDate } from '@/lib/cash-registers';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const id = String(body.id ?? '').trim();
    const lastVerificationDateRaw = String(body.last_verification_date ?? '').trim();
    const identifierRaw = String(body.identifier ?? '').trim();

    if (!id) {
      return NextResponse.json({ error: 'ID cassa mancante' }, { status: 400 });
    }

    const lastVerificationDate = lastVerificationDateRaw || null;
    const nextVerificationDate = calculateNextVerificationDate(lastVerificationDate);
    const identifier = identifierRaw || null;

    const { data, error } = await supabaseAdmin
      .from('cash_registers')
      .update({
        identifier,
        last_verification_date: lastVerificationDate,
        next_verification_date: nextVerificationDate,
      })
      .eq('id', id)
      .select(
        'id, pv_id, label, identifier, qr_image_url, last_verification_date, next_verification_date',
      )
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Errore salvataggio cassa: ${error.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      item: data,
      message: 'Cassa aggiornata con successo',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore imprevisto';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}