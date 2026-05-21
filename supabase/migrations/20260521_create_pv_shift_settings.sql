-- Modulo Turni - Codice responsabile PV
-- Crea impostazioni per proteggere la sezione Turni lato PV con codice responsabile.

create table if not exists public.pv_shift_settings (
  id uuid primary key default gen_random_uuid(),
  pv_id uuid not null references public.pvs(id) on delete cascade,
  pin_hash text null,
  enabled boolean not null default true,
  updated_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pv_shift_settings_pv_id_unique unique (pv_id)
);

create index if not exists pv_shift_settings_pv_id_idx
  on public.pv_shift_settings(pv_id);

create trigger set_pv_shift_settings_updated_at
before update on public.pv_shift_settings
for each row
execute function public.set_updated_at();

alter table public.pv_shift_settings enable row level security;

grant select, insert, update on public.pv_shift_settings to authenticated;

-- Policy predisposte per un eventuale futuro uso con JWT Supabase.
-- Nell'architettura attuale l'accesso passa da API Next server-side con cookie custom.
drop policy if exists pv_shift_settings_select_admin_or_own_pv on public.pv_shift_settings;
create policy pv_shift_settings_select_admin_or_own_pv
on public.pv_shift_settings
for select
to authenticated
using (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') in ('admin', 'amministrativo')
  or pv_id::text = coalesce(auth.jwt() ->> 'pv_id', '')
);

drop policy if exists pv_shift_settings_insert_admin on public.pv_shift_settings;
create policy pv_shift_settings_insert_admin
on public.pv_shift_settings
for insert
to authenticated
with check (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') in ('admin', 'amministrativo')
);

drop policy if exists pv_shift_settings_update_admin on public.pv_shift_settings;
create policy pv_shift_settings_update_admin
on public.pv_shift_settings
for update
to authenticated
using (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') in ('admin', 'amministrativo')
)
with check (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') in ('admin', 'amministrativo')
);
