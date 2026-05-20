-- =========================================
-- AGGIORNAMENTO MODULO TURNI
-- Supporto turni notturni
-- =========================================
-- Permette turni che attraversano la mezzanotte.
-- Esempio: 21:00 - 05:00 viene considerato valido
-- e viene conteggiato nel giorno di inizio del turno.

begin;

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
