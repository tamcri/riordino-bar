import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import {
  getCashRegisterAlert,
  getCashRegisterStatus,
  getCashRegisterStatusLabel,
  getDaysRemaining,
} from '@/lib/cash-registers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const EXCLUDED_PV_IDS = ['ed42ce52-a6bd-46cc-8609-9e5d1bb1f524'];
const STORAGE_BUCKET = 'reorder-results';

function shouldShowCashRegister(item: {
  label: string;
  is_enabled: boolean | null;
  qr_image_url: string | null;
  last_verification_date: string | null;
  next_verification_date: string | null;
}) {
  if (item.label === 'Cassa 1') return true;
  if (item.is_enabled) return true;

  return Boolean(
    item.qr_image_url ||
      item.last_verification_date ||
      item.next_verification_date,
  );
}

async function buildSignedUrl(path: string | null) {
  if (!path) return null;

  const { data, error } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, 60 * 60);

  if (error) {
    console.error('Errore signed URL QR:', error.message);
    return null;
  }

  return data?.signedUrl ?? null;
}

export async function GET() {
  try {
    const [{ data: pvs, error: pvsError }, { data: cashRegisters, error: cashRegistersError }] =
      await Promise.all([
        supabaseAdmin
          .from('pvs')
          .select('id, code, name')
          .order('code', { ascending: true }),
        supabaseAdmin
          .from('cash_registers')
          .select(
            'id, pv_id, label, identifier, qr_image_url, last_verification_date, next_verification_date, is_enabled, created_at, updated_at',
          )
          .order('pv_id', { ascending: true })
          .order('label', { ascending: true }),
      ]);

    if (pvsError) {
      return NextResponse.json(
        { error: `Errore lettura PV: ${pvsError.message}` },
        {
          status: 500,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          },
        },
      );
    }

    if (cashRegistersError) {
      return NextResponse.json(
        { error: `Errore lettura casse: ${cashRegistersError.message}` },
        {
          status: 500,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          },
        },
      );
    }

    const filteredPvs = (pvs ?? []).filter((pv) => !EXCLUDED_PV_IDS.includes(pv.id));

    const pvMap = new Map(
      filteredPvs.map((pv) => [
        pv.id,
        {
          code: pv.code ?? '',
          name: pv.name ?? '',
        },
      ]),
    );

    const visibleRegisters = [...(cashRegisters ?? [])]
      .filter((item) => pvMap.has(item.pv_id))
      .filter((item) => shouldShowCashRegister(item))
      .sort((a, b) => {
        const pvA = pvMap.get(a.pv_id);
        const pvB = pvMap.get(b.pv_id);

        const codeA = pvA?.code ?? '';
        const codeB = pvB?.code ?? '';

        if (codeA !== codeB) {
          return codeA.localeCompare(codeB, 'it');
        }

        return a.label.localeCompare(b.label, 'it');
      });

    const rows = await Promise.all(
      visibleRegisters.map(async (item) => {
        const pv = pvMap.get(item.pv_id);
        const signedQrUrl = await buildSignedUrl(item.qr_image_url);

        return {
          id: item.id,
          pv_id: item.pv_id,
          pv_code: pv?.code ?? '',
          pv_name: pv?.name ?? '',
          label: item.label,
          identifier: item.identifier,
          qr_image_url: signedQrUrl,
          qr_image_path: item.qr_image_url,
          last_verification_date: item.last_verification_date,
          next_verification_date: item.next_verification_date,
          is_enabled: item.is_enabled,
          status: getCashRegisterStatus(item.next_verification_date),
          status_label: getCashRegisterStatusLabel(item.next_verification_date),
          alert: getCashRegisterAlert(item.next_verification_date),
          days_remaining: getDaysRemaining(item.next_verification_date),
          created_at: item.created_at,
          updated_at: item.updated_at,
        };
      }),
    );

    return NextResponse.json(
      { items: rows, generated_at: new Date().toISOString() },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Errore imprevisto';
    return NextResponse.json(
      { error: message },
      {
        status: 500,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
          Pragma: 'no-cache',
          Expires: '0',
        },
      },
    );
  }
}