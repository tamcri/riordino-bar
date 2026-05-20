-- =========================================
-- AGGIORNAMENTO MODULO TURNI
-- Spezzato mattina/pomeriggio + Ferie
-- =========================================
-- Aggiunge due colonne per il secondo blocco orario:
-- - second_start_time
-- - second_end_time
--
-- Nuovi status:
-- - split    = Spezzato
-- - vacation = Ferie

begin;

alter table public.work_shifts
  add column if not exists second_start_time time null,
  add column if not exists second_end_time time null;

alter table public.work_shifts
  drop constraint if exists work_shifts_status_check;

alter table public.work_shifts
  add constraint work_shifts_status_check
  check (status in ('work', 'split', 'rest', 'vacation', 'change'));

alter table public.work_shifts
  drop constraint if exists work_shifts_time_rules_check;

alter table public.work_shifts
  add constraint work_shifts_time_rules_check
  check (
    (
      status in ('rest', 'vacation')
      and start_time is null
      and end_time is null
      and second_start_time is null
      and second_end_time is null
    )
    or
    (
      status in ('work', 'change')
      and start_time is not null
      and end_time is not null
      and end_time > start_time
      and second_start_time is null
      and second_end_time is null
    )
    or
    (
      status = 'split'
      and start_time is not null
      and end_time is not null
      and second_start_time is not null
      and second_end_time is not null
      and end_time > start_time
      and second_end_time > second_start_time
      and second_start_time > end_time
    )
  );

commit;
