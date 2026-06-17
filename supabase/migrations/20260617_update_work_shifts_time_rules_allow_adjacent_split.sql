-- =========================================
-- AGGIORNAMENTO REGOLE ORARIE TURNI
-- Consente spezzato con secondo turno che inizia
-- esattamente alla fine del primo turno.
--
-- Esempio valido:
-- 05:00 - 12:00
-- 12:00 - 15:00
-- =========================================

begin;

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
  );

commit;