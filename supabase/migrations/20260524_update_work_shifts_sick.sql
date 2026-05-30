-- =========================================
-- AGGIORNAMENTO MODULO TURNI
-- Aggiunge stato Malattia
-- =========================================
-- Nuovo status:
-- - sick = Malattia
--
-- Malattia non richiede orari e vale 0 ore, come Riposo/Ferie.

begin;

alter table public.work_shifts
  drop constraint if exists work_shifts_status_check;

alter table public.work_shifts
  add constraint work_shifts_status_check
  check (status in ('work', 'split', 'rest', 'vacation', 'sick', 'change'));

alter table public.work_shifts
  drop constraint if exists work_shifts_time_rules_check;

alter table public.work_shifts
  add constraint work_shifts_time_rules_check
  check (
    (
      status in ('rest', 'vacation', 'sick')
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
      and end_time <> start_time
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
      and end_time <> start_time
      and second_end_time <> second_start_time
      and second_start_time <> end_time
    )
  );

commit;
