import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const pvId = String(body?.pv_id ?? '').trim();

    if (!pvId) {
      return NextResponse.json(
        { error: 'PV mancante' },
        { status: 400 },
      );
    }

    // Controlla che il PV esista
    const { data: pv, error: pvError } = await supabaseAdmin
      .from('pvs')
      .select('id, code, name')
      .eq('id', pvId)
      .maybeSingle();

    if (pvError) {
      return NextResponse.json(
        { error: `Errore verifica PV: ${pvError.message}` },
        { status: 500 },
      );
    }

    if (!pv) {
      return NextResponse.json(
        { error: 'PV non trovato' },
        { status: 404 },
      );
    }

    // Legge tutte le casse già esistenti per il PV,
    // comprese quelle eventualmente disattivate.
    const { data: existingRegisters, error: registersError } =
      await supabaseAdmin
        .from('cash_registers')
        .select('id, label, is_enabled')
        .eq('pv_id', pvId);

    if (registersError) {
      return NextResponse.json(
        { error: `Errore lettura casse: ${registersError.message}` },
        { status: 500 },
      );
    }

    // Trova il numero più alto già utilizzato:
    // Cassa 1, Cassa 2, Cassa 3...
    let maxNumber = 0;

    for (const register of existingRegisters ?? []) {
      const match = /^Cassa\s+(\d+)$/i.exec(
        String(register.label ?? '').trim(),
      );

      if (!match) continue;

      const number = Number(match[1]);

      if (Number.isFinite(number) && number > maxNumber) {
        maxNumber = number;
      }
    }

    const nextNumber = maxNumber + 1;
    const nextLabel = `Cassa ${nextNumber}`;

    const { data: created, error: createError } = await supabaseAdmin
      .from('cash_registers')
      .insert({
        pv_id: pvId,
        label: nextLabel,
        is_enabled: true,
      })
      .select(
        'id, pv_id, label, identifier, qr_image_url, last_verification_date, next_verification_date, is_enabled, created_at, updated_at',
      )
      .single();

    if (createError) {
      return NextResponse.json(
        { error: `Errore creazione cassa: ${createError.message}` },
        { status: 500 },
      );
    }

    return NextResponse.json({
      item: created,
      message: `${nextLabel} creata con successo`,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Errore imprevisto';

    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}