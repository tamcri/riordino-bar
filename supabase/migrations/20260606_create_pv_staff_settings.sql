-- Impostazioni organico minimo per punto vendita.
-- Non modifica pvs, employees o work_shifts.

create table if not exists public.pv_staff_settings (
  id uuid primary key default gen_random_uuid(),
  pv_id uuid not null references public.pvs(id) on delete cascade,
  min_employees integer not null default 0,
  note text null,
  updated_by uuid null references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint pv_staff_settings_min_employees_check check (min_employees >= 0 and min_employees <= 999),
  constraint pv_staff_settings_pv_unique unique (pv_id)
);

create index if not exists pv_staff_settings_pv_id_idx
  on public.pv_staff_settings (pv_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists trg_pv_staff_settings_updated_at on public.pv_staff_settings;
create trigger trg_pv_staff_settings_updated_at
before update on public.pv_staff_settings
for each row execute function public.set_updated_at();

alter table public.pv_staff_settings enable row level security;

-- Policy predisposte per eventuale uso con Supabase Auth/JWT.
-- L'app attuale usa API server-side con controllo ruolo e service role.
drop policy if exists pv_staff_settings_select_admin on public.pv_staff_settings;
create policy pv_staff_settings_select_admin
on public.pv_staff_settings
for select
to authenticated
using (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') = 'admin'
);

drop policy if exists pv_staff_settings_insert_admin on public.pv_staff_settings;
create policy pv_staff_settings_insert_admin
on public.pv_staff_settings
for insert
to authenticated
with check (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') = 'admin'
);

drop policy if exists pv_staff_settings_update_admin on public.pv_staff_settings;
create policy pv_staff_settings_update_admin
on public.pv_staff_settings
for update
to authenticated
using (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') = 'admin'
)
with check (
  coalesce(auth.jwt() ->> 'app_role', auth.jwt() ->> 'role') = 'admin'
);

-- Grant espliciti sulle nuove tabelle esposte.
grant select, insert, update on table public.pv_staff_settings to authenticated;
