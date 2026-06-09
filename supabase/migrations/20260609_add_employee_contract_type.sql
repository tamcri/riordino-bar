alter table public.employees
add column if not exists contract_type text not null default 'full_time';

update public.employees
set contract_type = 'full_time'
where contract_type is null
   or contract_type not in ('full_time', 'part_time');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'employees_contract_type_check'
      and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
    add constraint employees_contract_type_check
    check (contract_type in ('full_time', 'part_time'));
  end if;
end $$;