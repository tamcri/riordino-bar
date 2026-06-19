-- =========================================
-- AGGIORNAMENTO MODULO TURNI
-- Nuovo stato: support = Di supporto
-- =========================================
-- Significato:
-- il dipendente non lavora nel suo PV principale
-- perche' e' impegnato come supporto in un altro PV.
--
-- Regole:
-- - nessun orario obbligatorio
-- - 0 ore nel PV principale
-- - nota opzionale, es. "A5"

begin;

alter table public.work_shifts
  drop constraint if exists work_shifts_status_check;

alter table public.work_shifts
  add constraint work_shifts_status_check
  check (
    status in (
      'work',
      'split',
      'rest',
      'vacation',
      'sick',
      'change',
      'support'
    )
  )
  not valid;

alter table public.work_shifts
  drop constraint if exists work_shifts_time_rules_check;

alter table public.work_shifts
  add constraint work_shifts_time_rules_check
  check (
    (
      status in ('rest', 'vacation', 'sick', 'support')
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
      and second_start_time >= end_time
    )
  )
  not valid;

commit;