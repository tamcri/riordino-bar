-- =========================================
-- AGGIORNAMENTO MODULO TURNI
-- PV effettivo di lavoro per blocchi turno
-- =========================================
-- Aggiunge due campi opzionali a work_shifts:
-- - work_pv_id: PV dove viene svolto il primo blocco turno
-- - second_work_pv_id: PV dove viene svolto il secondo blocco turno, se presente
--
-- I campi restano NULL sui dati esistenti.
-- L'applicazione usera' il fallback:
-- - work_pv_id null => pv_id
-- - second_work_pv_id null => work_pv_id oppure pv_id

begin;

alter table public.work_shifts
  add column if not exists work_pv_id uuid null,
  add column if not exists second_work_pv_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_shifts_work_pv_fk'
      and conrelid = 'public.work_shifts'::regclass
  ) then
    alter table public.work_shifts
      add constraint work_shifts_work_pv_fk
      foreign key (work_pv_id)
      references public.pvs(id)
      on delete set null
      not valid;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'work_shifts_second_work_pv_fk'
      and conrelid = 'public.work_shifts'::regclass
  ) then
    alter table public.work_shifts
      add constraint work_shifts_second_work_pv_fk
      foreign key (second_work_pv_id)
      references public.pvs(id)
      on delete set null
      not valid;
  end if;
end $$;

alter table public.work_shifts
  validate constraint work_shifts_work_pv_fk;

alter table public.work_shifts
  validate constraint work_shifts_second_work_pv_fk;

create index if not exists idx_work_shifts_work_pv_id
  on public.work_shifts(work_pv_id);

create index if not exists idx_work_shifts_second_work_pv_id
  on public.work_shifts(second_work_pv_id);

commit;